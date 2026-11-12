import { Text,View } from "react-native";
import Svg,{
Defs,
Path,
Stop,
LinearGradient as SvgGradient,
} from "react-native-svg";
import { fonts } from "../theme";

export function PlexyMark({ size = 22 }: { size?: number }) {
  const height = (size * 277) / 256;
  return (
    <Svg
      width={size}
      height={height}
      viewBox="0 0 256 277"
      style={{ overflow: "visible" }}
    >
      <Defs>
        <SvgGradient id="plexy__blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#6C9FFF" />
          <Stop offset="50%" stopColor="#3B7DF9" />
          <Stop offset="100%" stopColor="#1F4FCB" />
        </SvgGradient>
      </Defs>
      <Path
        fill="url(#plexy__blue)"
        d="M223.517 44.823 161.174 8.85a65.565 65.565 0 0 0-65.792 0l-62.63 35.973C12.642 56.623 0 78.495 0 101.806v72.235c0 23.6 12.641 45.183 32.752 56.982l62.343 36.263a65.565 65.565 0 0 0 65.791 0l62.343-36.263c20.399-11.799 32.752-33.383 32.752-56.982v-72.235c.575-23.311-12.066-45.183-32.464-56.983Zm-95.383 157.422c-35.337 0-64.067-28.78-64.067-64.177 0-35.399 28.73-64.178 64.067-64.178 35.338 0 64.355 28.779 64.355 64.178 0 35.398-28.73 64.177-64.355 64.177Z"
      />
    </Svg>
  );
}

export function PlexyLogo({
  size = 22,
  showText = true,
}: {
  size?: number;
  showText?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <PlexyMark size={size} />
      {showText && (
        <Text
          style={{
            fontFamily: fonts.black,
            fontSize: size * 0.95,
            color: "#ffffff",
            letterSpacing: -0.4,
          }}
        >
          Plexy
        </Text>
      )}
    </View>
  );
}

