export type PainelDashboardRpc = {
  meta: {
    timezone: string;
    today: string;
    month_start: string;
    professionals_active: number;
    clinic_ativo: boolean;
    ia_active: boolean;
  };
  month: {
    revenue: number;
    revenue_prev: number;
    new_patients: number;
    new_patients_prev: number;
    confirmation_rate: number;
    confirmation_rate_prev: number;
    occupancy_today_pct: number;
  };
  insights: {
    confirmation_pct: number;
    return_pct: number;
    occupancy_pct: number;
    alerts: {
      retorno_vencido_count: number;
      receita_represada: number;
      agenda_buracos_count: number;
    };
  };
  top_services: { name: string; count: number; revenue: number }[];
};

export type PainelCsSlotRow = {
  horario_id?: string;
  profissional_id: string;
  profissional_nome?: string;
  horario: string;
  disponivel: boolean;
  bloqueio_manual?: boolean;
  indisponivel_por?: string | null;
};
