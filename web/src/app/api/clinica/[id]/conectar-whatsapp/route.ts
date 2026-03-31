import { proxyToBackend } from "@/lib/backend-api";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clinicId } = await params;
  return proxyToBackend("/api/whatsapp/connect", {
    method: "POST",
    body: JSON.stringify({ clinicId }),
  });
}
