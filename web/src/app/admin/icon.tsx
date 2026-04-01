import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function AdminIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          background: "#f59e0b",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#0a0a0a",
          borderRadius: 6,
        }}
      >
        A
      </div>
    ),
    { ...size }
  );
}
