"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type PlanoApi = {
  id: string;
  codigo: string;
  nome: string;
  preco_mensal: number | null;
  preco_anual: number | null;
  descricao: string | null;
  features: string[];
  ordem: number;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" as const },
  },
  hover: {
    y: -8,
    boxShadow: "0 20px 40px rgba(13, 107, 122, 0.15)",
    transition: { duration: 0.3 },
  },
};

const titleVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: "easeOut" as const },
  },
};

type Props = {
  urgencyDeadline: string;
};

export function LandingPricingSection({ urgencyDeadline }: Props) {
  const [planos, setPlanos] = useState<PlanoApi[] | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/planos", { credentials: "omit" });
        const j = (await res.json().catch(() => ({}))) as { planos?: PlanoApi[] };
        if (!res.ok || !j.planos) {
          if (!cancelled) {
            setFetchError(true);
            setPlanos([]);
          }
          return;
        }
        const visible = j.planos.filter((p) => p.codigo !== "teste");
        if (!cancelled) {
          setPlanos(visible);
          setFetchError(false);
        }
      } catch {
        if (!cancelled) {
          setFetchError(true);
          setPlanos([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmtMoney = (n: number | null) => {
    if (n == null) return "Sob consulta";
    if (n === 0) return "Grátis";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(n);
  };

  const fallbackPlanos: PlanoApi[] = [
    {
      id: "fb1",
      codigo: "basico",
      nome: "Básico",
      preco_mensal: 199,
      preco_anual: null,
      descricao: "Para consultórios pequenos e independentes.",
      features: [
        "Até 5 profissionais",
        "Confirmação automática básica",
        "Suporte por email",
      ],
      ordem: 1,
    },
    {
      id: "fb2",
      codigo: "mensal",
      nome: "Profissional",
      preco_mensal: 499,
      preco_anual: null,
      descricao: "Para clínicas em crescimento.",
      features: [
        "Até 20 profissionais",
        "Confirmação avançada",
        "Suporte por WhatsApp",
      ],
      ordem: 2,
    },
    {
      id: "fb3",
      codigo: "enterprise",
      nome: "Enterprise",
      preco_mensal: null,
      preco_anual: null,
      descricao: "Para redes e grandes clínicas.",
      features: ["Profissionais ilimitados", "Integrações customizadas"],
      ordem: 3,
    },
  ];

  const list =
    planos === null
      ? null
      : (() => {
          const sorted = [...planos].sort(
            (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)
          );
          if (sorted.length > 0) return sorted;
          return fetchError ? fallbackPlanos : [];
        })();

  return (
    <section className="section">
      <div className="container">
        <motion.h2
          className="text-center mb-4"
          variants={titleVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          Planos Simples e Transparentes
        </motion.h2>
        <motion.p
          className="text-center"
          style={{
            color: "var(--text-light)",
            marginBottom: "var(--spacing-2xl)",
            fontSize: "1.05rem",
          }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          viewport={{ once: true, margin: "-100px" }}
        >
          Escolha o plano que melhor se adequa ao tamanho e necessidade da sua clínica.
        </motion.p>

        {list === null ? (
          <p
            className="text-center"
            style={{ color: "var(--text-light)", marginBottom: "var(--spacing-2xl)" }}
          >
            A carregar planos…
          </p>
        ) : (
          <motion.div
            className="grid grid-3"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            style={{ marginBottom: "var(--spacing-2xl)" }}
          >
            {list.map((plan) => {
              const highlighted = plan.codigo === "mensal";
              const isEnterpriseish =
                plan.preco_mensal == null && plan.codigo === "enterprise";
              return (
                <motion.div
                  key={plan.id}
                  className="card"
                  variants={cardVariants}
                  whileHover="hover"
                  style={{
                    border: highlighted
                      ? "2px solid var(--primary)"
                      : "1px solid var(--border)",
                    background: highlighted
                      ? "linear-gradient(135deg, var(--primary), var(--primary-light))"
                      : "var(--card-bg)",
                    color: highlighted ? "white" : "inherit",
                  }}
                >
                  {highlighted ? (
                    <div
                      style={{
                        display: "inline-block",
                        background: "rgba(255,255,255,0.2)",
                        color: "white",
                        padding: "4px 12px",
                        borderRadius: "20px",
                        fontSize: "0.75rem",
                        fontWeight: "600",
                        marginBottom: "var(--spacing-md)",
                        textTransform: "uppercase",
                      }}
                    >
                      Mais escolhido
                    </div>
                  ) : null}
                  <h3 style={{ color: highlighted ? "white" : "inherit" }}>{plan.nome}</h3>
                  <p
                    style={{
                      color: highlighted ? "rgba(255,255,255,0.9)" : "var(--text-light)",
                    }}
                  >
                    {plan.descricao ?? ""}
                  </p>

                  <div
                    style={{
                      margin: "var(--spacing-lg) 0",
                      paddingBottom: "var(--spacing-lg)",
                      borderBottom: highlighted
                        ? "1px solid rgba(255,255,255,0.2)"
                        : "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "2.5rem",
                        fontWeight: "700",
                        color: highlighted ? "white" : "var(--primary)",
                      }}
                    >
                      {fmtMoney(plan.preco_mensal)}
                    </div>
                    {plan.preco_mensal != null && plan.preco_mensal > 0 ? (
                      <div
                        style={{
                          color: highlighted ? "rgba(255,255,255,0.8)" : "var(--text-light)",
                          fontSize: "0.9rem",
                        }}
                      >
                        /mês
                      </div>
                    ) : null}
                    {plan.preco_anual != null && plan.preco_anual > 0 ? (
                      <div
                        style={{
                          color: highlighted ? "rgba(255,255,255,0.85)" : "var(--text-light)",
                          fontSize: "0.85rem",
                          marginTop: "0.35rem",
                        }}
                      >
                        ou{" "}
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                          maximumFractionDigits: 0,
                        }).format(plan.preco_anual)}
                        /ano
                      </div>
                    ) : null}
                  </div>

                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "var(--spacing-lg) 0",
                      flex: 1,
                    }}
                  >
                    {(plan.features ?? []).map((feature, i) => (
                      <li
                        key={i}
                        style={{
                          padding: "var(--spacing-sm) 0",
                          color: highlighted ? "rgba(255,255,255,0.9)" : "inherit",
                        }}
                      >
                        ✓ {feature}
                      </li>
                    ))}
                  </ul>

                  <motion.button
                    className="btn"
                    style={{
                      width: "100%",
                      background: highlighted ? "white" : "var(--primary)",
                      color: highlighted ? "var(--primary)" : "white",
                      marginTop: "var(--spacing-md)",
                    }}
                    onClick={() => {
                      if (isEnterpriseish) {
                        window.open(
                          "https://wa.me/5511999999999?text=" +
                            encodeURIComponent(
                              `Olá! Gostaria de saber mais sobre o plano ${plan.nome} do AgendaClinic.`
                            ),
                          "_blank"
                        );
                      } else {
                        document.getElementById("demo-form")?.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isEnterpriseish ? "Falar com especialista" : `Quero o plano ${plan.nome}`}
                  </motion.button>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <motion.div
          className="text-center"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          viewport={{ once: true, margin: "-100px" }}
        >
          <div
            style={{
              background: "rgba(13, 107, 122, 0.1)",
              padding: "var(--spacing-lg)",
              borderRadius: "var(--radius-lg)",
              marginBottom: "var(--spacing-lg)",
            }}
          >
            <p
              style={{
                color: "var(--primary)",
                fontWeight: "600",
                marginBottom: "var(--spacing-sm)",
              }}
            >
              Preço especial até <strong>{urgencyDeadline}</strong>
            </p>
            <p style={{ color: "var(--text-dark)", marginBottom: 0 }}>
              <strong>Primeiros 30 clientes:</strong> 30% de desconto nos primeiros 3 meses —
              condição válida até a data acima ou até esgotar as vagas.
            </p>
          </div>
          <p
            style={{
              color: "var(--text-light)",
              marginBottom: "var(--spacing-sm)",
              fontSize: "0.95rem",
            }}
          >
            ✅ Sem cartão de crédito | ✅ 7 dias grátis | ✅ Cancele quando quiser
          </p>
          <p style={{ color: "var(--primary)", fontWeight: "600", marginBottom: 0 }}>
            ✅ Garantia 100%: Se não gostar, devolvemos seu dinheiro
          </p>
        </motion.div>
      </div>
    </section>
  );
}
