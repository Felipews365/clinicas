import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeProfessionalWhatsappBr } from "@/lib/br-whatsapp";
import {
  clienteWhatsAppReagendamentoAgendamento,
  normalizeProfissionalGenero,
  profWhatsAppReagendamento,
  profissionalComTratamento,
} from "@/lib/professional-notify-message";
import { sendEvolutionClinicInstanceText } from "@/lib/whatsapp-evolution-send";

type Body = {
  clinic_id?: string;
  patient_name?: string;
  patient_phone?: string;
  professional_name?: string | null;
  professional_gender?: string | null;
  professional_phone?: string | null;
  servico?: string;
  data_anterior?: string;
  hora_anterior?: string;
  nova_data?: string;
  novo_horario?: string;
};

/**
 * Após reagendar no painel (tabela `appointments` ou fluxo cs_agendamentos via RPC).
 * Envia WhatsApp ao paciente e ao profissional (Evolution `clinica-{id}`), se os números forem válidos.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const clinicId = body.clinic_id?.trim();
  if (!clinicId) {
    return NextResponse.json({ error: "clinic_id obrigatório" }, { status: 400 });
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: hasAccess } = await authClient.rpc("rls_has_clinic_access", {
    p_clinic_id: clinicId,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const patientName = (body.patient_name ?? "").trim() || "Cliente";
  const patientPhone = (body.patient_phone ?? "").trim();
  const profName = (body.professional_name ?? "").trim() || null;
  const profPhone = (body.professional_phone ?? "").trim() || null;
  const profGen = normalizeProfissionalGenero(body.professional_gender);
  const servico = (body.servico ?? "Consulta").trim();
  const da = (body.data_anterior ?? "").trim();
  const ha = (body.hora_anterior ?? "").trim();
  const nd = (body.nova_data ?? "").trim();
  const nh = (body.novo_horario ?? "").trim();

  if (!da || !ha || !nd || !nh) {
    return NextResponse.json(
      { error: "Datas e horários (antes e depois) são obrigatórios" },
      { status: 400 }
    );
  }

  const nomeProfissional =
    profissionalComTratamento(profName ?? "", profGen) || "Profissional";
  const clientText = clienteWhatsAppReagendamentoAgendamento({
    nomeCliente: patientName,
    servico,
    nomeProfissional,
    novaData: nd,
    novoHorario: nh,
  });

  const profText = profWhatsAppReagendamento({
    profissional: profName,
    profissionalGenero: profGen,
    cliente: patientName,
    clienteTelefone: patientPhone || null,
    servico,
    novaData: nd,
    novoHorario: nh,
    dataAnterior: da,
    horaAnterior: ha,
  });

  let notifiedPatient = false;
  let notifiedProfessional = false;

  if (patientPhone) {
    const pn = normalizeProfessionalWhatsappBr(patientPhone);
    if (pn.ok && pn.digits) {
      const s = await sendEvolutionClinicInstanceText(clinicId, pn.digits, clientText);
      notifiedPatient = s.ok;
    }
  }

  if (profPhone) {
    const pr = normalizeProfessionalWhatsappBr(profPhone);
    if (pr.ok && pr.digits) {
      const s = await sendEvolutionClinicInstanceText(clinicId, pr.digits, profText);
      notifiedProfessional = s.ok;
    }
  }

  return NextResponse.json({
    ok: true,
    notified_patient: notifiedPatient,
    notified_professional: notifiedProfessional,
  });
}
