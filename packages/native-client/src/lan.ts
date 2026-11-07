import { NativeModules } from "react-native";
export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
}
export interface ServerCertificate {
  url: string;
  fingerprint: string;
  subject: string;
  validTo: string;
  trusted: boolean;
}
interface LanModule {
  discoverServers(): Promise<DiscoveredServer[]>;
  cancelDiscovery(): void;
  inspectServer(url: string): Promise<ServerCertificate>;
  trustServer(url: string, fingerprint: string): Promise<void>;
  forgetCertificate(fingerprint: string): Promise<void>;
}
function module(): LanModule {
  const value = NativeModules.PlexyLan as LanModule | undefined;
  if (!value)
    throw new Error(
      "Install the updated Plexy APK to enable local-server discovery and certificate approval.",
    );
  return value;
}
export const lan = {
  discoverServers: () => module().discoverServers(),
  cancelDiscovery: () => {
    (NativeModules.PlexyLan as LanModule | undefined)?.cancelDiscovery();
  },
  inspectServer: (url: string) => module().inspectServer(url),
  trustServer: (certificate: ServerCertificate) =>
    module().trustServer(certificate.url, certificate.fingerprint),
  forgetCertificate: (fingerprint: string) =>
    module().forgetCertificate(fingerprint),
};
