import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import {
  ApiError,
  PlexyApi,
  normalizeServerUrl,
  type Profile,
  type Session,
} from "../../../../packages/native-client/src/api";
import { sessionStore } from "../../../../packages/native-client/src/storage";
import { Button, Field, Heading, Label, Notice, UserAvatar } from "../components/ui";
import { colors } from "../ui/theme";
import { lan, type DiscoveredServer, type ServerCertificate } from "../../../../packages/native-client/src/lan";
import { connectionError, requiresSecureLanResolution } from "../../../../packages/native-client/src/lan-policy";
export function Connect({
  tv,
  onConnected,
  onCancel,
}: {
  tv: boolean;
  onConnected: (session: Session) => void;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"pair" | "login">("pair");
  const [allowHttp, setAllowHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [certificate, setCertificate] = useState<ServerCertificate | null>(
    null,
  );
  const [connectionNote, setConnectionNote] = useState("");
  const live = useRef(true);
  const discover = useCallback(async () => {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const servers = await lan.discoverServers();
      if (live.current) setDiscovered(servers);
    } catch (error) {
      if (live.current) setDiscoveryError(connectionError(error));
    } finally {
      if (live.current) setDiscovering(false);
    }
  }, []);
  useEffect(() => {
    live.current = true;
    void discover();
    return () => {
      live.current = false;
      lan.cancelDiscovery();
    };
  }, [discover]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    void sessionStore
      .profiles()
      .then(setProfiles)
      .catch(() => setError("Saved server profiles could not be loaded."));
  }, []);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      let base = normalizeServerUrl(url);
      let status;
      if (requiresSecureLanResolution(base)) {
        // Never hand a LAN HTTP address to fetch, images or the player. Android's
        // cleartext restriction stays enabled; credentials travel over HTTPS.
        const inspected = await lan.inspectServer(base);
        base = inspected.url;
        setUrl(base);
        setConnectionNote("Using the server’s secure LAN address.");
        if (!inspected.trusted) {
          setCertificate(inspected);
          return;
        }
      } else if (base.startsWith("http:") && !allowHttp) {
        throw new Error(
          "Enable local HTTP development access for this loopback connection.",
        );
      }
      let api = new PlexyApi(base);
      try {
        status = await api.status();
      } catch (error) {
        if (!base.startsWith("https:")) throw error;
        try {
          const inspected = await lan.inspectServer(base);
          base = inspected.url;
          setUrl(base);
          if (!inspected.trusted) {
            setCertificate(inspected);
            return;
          }
          api = new PlexyApi(base);
          status = await api.status();
        } catch (inspectionError) {
          throw new Error(connectionError(inspectionError));
        }
      }
      if (!status.ownerCreated || !status.setupComplete)
        throw new Error(
          "Finish server setup in Plexy on the computer running your server, then reconnect.",
        );
      const auth =
        mode === "pair"
          ? await api.pair(code, tv ? "Plexy TV" : "Plexy Android")
          : await api.login(
              username,
              password,
              tv ? "Plexy TV" : "Plexy Android",
            );
      if (
        !auth.serverId ||
        !auth.token ||
        !auth.user?.id ||
        (status.serverId && status.serverId !== auth.serverId)
      )
        throw new Error(
          "The server identity changed while connecting. Check the address and try again.",
        );
      const session: Session = {
        token: auth.token,
        profile: {
          id: `${auth.serverId}:${auth.user.id}`,
          serverId: auth.serverId,
          userId: auth.user.id,
          username: auth.user.username,
          url: base,
          name: new URL(base).host,
        },
      };
      await sessionStore.save(session);
      setPassword("");
      setCode("");
      onConnected(session);
    } catch (e) {
      setError(connectionError(e));
    } finally {
      setBusy(false);
    }
  }
  async function activate(id: string) {
    setBusy(true);
    setError("");
    try {
      const session = await sessionStore.load(id);
      if (!session)
        throw new Error(
          "The saved credential is missing. Pair this server again.",
        );
      let address = session.profile.url;
      if (requiresSecureLanResolution(address)) {
        const inspected = await lan.inspectServer(address);
        address = inspected.url;
        setUrl(address);
        if (!inspected.trusted) {
          setCertificate(inspected);
          return;
        }
      } else if (address.startsWith("https:")) {
        try {
          await new PlexyApi(address).status();
        } catch {
          const inspected = await lan.inspectServer(address);
          address = inspected.url;
          setUrl(address);
          if (!inspected.trusted) {
            setCertificate(inspected);
            return;
          }
        }
      }
      session.profile = {
        ...session.profile,
        url: address,
        name: new URL(address).host,
      };
      try {
        await new PlexyApi(address, session.token).me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setUrl(address);
          setUsername(session.profile.username);
          setMode("login");
          throw new Error(
            "This saved sign-in is no longer valid. Sign in again below using your current Plexy password.",
          );
        }
        throw error;
      }
      await sessionStore.save(session);
      onConnected(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={true}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: tv ? 48 : 24,
          paddingBottom: tv ? 48 : 140,
          flexGrow: 1,
          justifyContent: tv ? "center" : undefined,
          alignItems: "center",
          backgroundColor: colors.canvas,
        }}
      >
      <View style={{ width: "100%", maxWidth: tv ? 620 : 480, gap: 20 }}>
        <Label muted>Plexy{tv ? " TV" : ""}</Label>
        <Heading large>Connect to your server</Heading>
        <Label muted>
          Your library, on this screen. Keep Plexy Server running on your
          computer or server.
        </Label>
        {profiles.length > 0 && (
          <View style={{ gap: 10 }}>
            <Heading>Saved servers</Heading>
            {profiles.map((p) => (
              <View key={p.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <UserAvatar name={p.username || p.name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Button
                      label={`${p.name} · ${p.username}`}
                      disabled={busy}
                      onPress={() => void activate(p.id)}
                    />
                  </View>
                </View>
                <Button
                  label={`Remove saved server ${p.name}`}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Remove saved server?",
                      "This removes its saved connection. Downloaded media remains private on this device until you reconnect to the same account and remove it.",
                      [
                        { text: "Keep", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => {
                            void sessionStore
                              .load(p.id)
                              .then(async (saved) => {
                                if (saved)
                                  await new PlexyApi(
                                    saved.profile.url,
                                    saved.token,
                                  )
                                    .logout()
                                    .catch(() => {});
                                await sessionStore.remove(p.id);
                                setProfiles(await sessionStore.profiles());
                              })
                              .catch(() =>
                                setError(
                                  "Could not remove the saved connection.",
                                ),
                              );
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            ))}
          </View>
        )}
        <View style={{ gap: 10 }}>
          <Heading>Servers on this network</Heading>
          <Button
            label={
              discovering
                ? "Looking for Plexy servers…"
                : "Find servers on this network"
            }
            icon="search"
            disabled={discovering || busy}
            onPress={() => void discover()}
          />
          {discovered.map((server) => (
            <Button
              key={server.id}
              label={`${server.name} · ${server.url}`}
              disabled={busy}
              onPress={() => {
                setUrl(server.url);
                setCertificate(null);
                setError("");
                setConnectionNote("");
              }}
            />
          ))}
          {!discovering && !discovered.length && (
            <Label muted>
              No servers found. Enable LAN access in Plexy Server, use the same
              Wi-Fi/network and retry. Guest Wi-Fi or router device isolation
              may block discovery. You can also enter the server address below.
            </Label>
          )}
          {!!discoveryError && <Label muted>{discoveryError}</Label>}
        </View>
        <Field
          label="Server address"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setCertificate(null);
            setConnectionNote("");
          }}
          placeholder="https://your-server:3240"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Button
          label={`${allowHttp ? "✓ " : ""}Allow HTTP on localhost for development`}
          selected={allowHttp}
          disabled={busy}
          onPress={() => setAllowHttp((v) => !v)}
        />
        <Label muted>
          Local network addresses use HTTPS. If your server has a local
          certificate, compare its fingerprint with Plexy Server before
          approving it. HTTP is only used for localhost development.
        </Label>
        {!!connectionNote && <Label muted>{connectionNote}</Label>}
        {certificate && (
          <View
            style={{
              gap: 14,
              padding: 18,
              borderWidth: 1,
              borderColor: colors.strong,
            }}
          >
            <Heading>Trust this local server?</Heading>
            <Label>{certificate.url}</Label>
            <Label muted>
              Compare this SHA-256 fingerprint with the LAN certificate
              fingerprint shown on the server computer or in Plexy’s account
              settings. Approve only if they match. Your password and pairing
              key have not been sent.
            </Label>
            <Label selectable>{certificate.fingerprint}</Label>
            <Label muted>
              Valid until {new Date(certificate.validTo).toLocaleDateString()}
            </Label>
            <Button
              label="Fingerprints match — trust server"
              primary
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setError("");
                void lan
                  .trustServer(certificate)
                  .then(() => {
                    setCertificate(null);
                    setConnectionNote(
                      "Server certificate approved. Choose Connect to sign in.",
                    );
                  })
                  .catch((error) => setError(connectionError(error)))
                  .finally(() => setBusy(false));
              }}
            />
            <Button
              label="Cancel certificate approval"
              disabled={busy}
              onPress={() => setCertificate(null)}
            />
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button
            label="Pairing code"
            selected={mode === "pair"}
            disabled={busy}
            onPress={() => setMode("pair")}
          />
          <Button
            label="Sign in"
            selected={mode === "login"}
            disabled={busy}
            onPress={() => setMode("login")}
          />
        </View>
        {mode === "pair" ? (
          <>
            <Field
              label="Pairing code"
              value={code}
              onChangeText={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              placeholder="000000"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onSubmitEditing={() => void connect()}
            />
            <Label muted>
              Generate a pairing code from your account in the existing Plexy
              app.
            </Label>
          </>
        ) : (
          <>
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!busy}
              onSubmitEditing={() => void connect()}
            />
          </>
        )}
        {!!error && <Notice message={error} />}
        <Button
          label={busy ? "Connecting…" : "Connect"}
          primary
          disabled={
            busy ||
            !url ||
            (mode === "pair" ? code.length !== 6 : !username.trim() || !password)
          }
          onPress={() => void connect()}
        />
        {onCancel && (
          <Button label="Cancel" disabled={busy} onPress={onCancel} />
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
