// Requires a compiled mobile release variant. Runs production Kotlin TLS classes
// on the JVM with small Android preferences/Base64 adapters and real TLS sockets.
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { resolve, join, delimiter } from "node:path";
const root = resolve(import.meta.dir, "../..");
const javaHome = Bun.env.JAVA_HOME;
if (!javaHome) throw new Error("Set JAVA_HOME to JDK 17.");
const cache = join(homedir(), ".gradle/caches/modules-2/files-2.1");
async function jar(pattern: string) {
  const values = [
    ...new Bun.Glob(pattern).scanSync({ cwd: cache, absolute: true }),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!values.length)
    throw new Error(`Build the mobile app first; missing ${pattern}`);
  return values.at(-1)!;
}
const cp = [
  resolve(root, "apps/mobile/android/app/build/tmp/kotlin-classes/release"),
  await jar("org.jetbrains.kotlin/kotlin-stdlib/*/*/*.jar"),
  await jar("com.squareup.okhttp3/okhttp/4.12.0/*/*.jar"),
  await jar("com.squareup.okio/okio-jvm/*/*/*.jar"),
];
const temp = await mkdtemp(join(tmpdir(), "plexy-lan-tls-"));
async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited) throw new Error("LAN TLS integration check failed.");
}
try {
  for (const name of ["local", "platform"])
    await run([
      join(javaHome, "bin/keytool"),
      "-genkeypair",
      "-alias",
      "server",
      "-keyalg",
      "EC",
      "-dname",
      `CN=${name}`,
      "-ext",
      "SAN=dns:localhost",
      "-validity",
      "2",
      "-storetype",
      "PKCS12",
      "-keystore",
      join(temp, `${name}.p12`),
      "-storepass",
      "local-test-only",
      "-keypass",
      "local-test-only",
      "-noprompt",
    ]);
  const classes = join(temp, "classes");
  await mkdir(classes);
  const sources = [
    ...new Bun.Glob("scripts/native/tests/**/*.java").scanSync({
      cwd: root,
      absolute: true,
    }),
  ];
  await run([
    join(javaHome, "bin/javac"),
    "-cp",
    cp.join(delimiter),
    "-d",
    classes,
    ...sources,
  ]);
  await run([
    join(javaHome, "bin/java"),
    "-cp",
    [classes, ...cp].join(delimiter),
    "LanTlsIntegration",
    join(temp, "local.p12"),
    join(temp, "platform.p12"),
  ]);
} finally {
  await rm(temp, { recursive: true, force: true });
}
