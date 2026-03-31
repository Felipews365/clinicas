import { proxyToBackend } from "@/lib/backend-api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clinicId } = await params;
  return proxyToBackend(`/api/whatsapp/status?clinicId=${encodeURIComponent(clinicId)}`, {
    method: "GET",
  });
}
