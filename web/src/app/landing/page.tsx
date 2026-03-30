'use client';

import { useState, useEffect } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';

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

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
  hover: {
    y: -8,
    boxShadow: '0 20px 40px rgba(13, 107, 122, 0.15)',
    transition: { duration: 0.3 },
  },
};

const stepVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.6,
      delay: i * 0.15,
      ease: 'easeOut',
    },
  }),
};

const titleVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: 'easeOut' },
  },
};

export default function LandingPage() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.3]);
  const heroY = useTransform(scrollY, [0, 300], [0, 100]);

  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(prefersDark);
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name');
    const clinic = formData.get('clinic');
    const specialty = formData.get('specialty');
    const message = formData.get('message');

    const whatsappMessage = `Olá! Sou ${name}, da clínica "${clinic}" (${specialty}). Gostaria de agendar uma demonstração do AgendaClinic. ${message ? `Mensagem adicional: ${message}` : ''}`;
    const whatsappUrl = `https://wa.me/5511999999999?text=${encodeURIComponent(whatsappMessage)}`;

    window.open(whatsappUrl, '_blank');
    e.currentTarget.reset();
  };

  return (
    <html lang="pt-BR" className={isDarkMode ? 'dark' : 'light'}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Agendamento Inteligente para Clínicas | Sistema Profissional</title>
        <meta name="description" content="Transforme o atendimento da sua clínica com agendamento inteligente, confirmação automática e redução de faltas. Solução premium para consultórios médicos, odontológicos e estética." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          html {
            scroll-behavior: smooth;
          }

          html.light {
            --primary: #0d6b7a;
            --primary-dark: #094f57;
            --primary-light: #1a8d9e;
            --accent: #e5484d;
            --text-dark: #1a1a1a;
            --text-light: #666666;
            --text-lighter: #999999;
            --bg-light: #ffffff;
            --bg-alt: #f8f7f5;
            --border: #e8e8e8;
            --success: #2d8a6b;
          }

          html.dark {
            --primary: #0d6b7a;
            --primary-dark: #094f57;
            --primary-light: #1a8d9e;
            --accent: #e5484d;
            --text-dark: #f5f5f5;
            --text-light: #d0d0d0;
            --text-lighter: #888888;
            --bg-light: #0d0d0d;
            --bg-alt: #1a1a1a;
            --border: #2a2a2a;
            --success: #2d8a6b;
          }

          :root {
            --spacing-xs: 0.5rem;
            --spacing-sm: 1rem;
            --spacing-md: 1.5rem;
            --spacing-lg: 2rem;
            --spacing-xl: 3rem;
            --spacing-2xl: 4rem;

            --radius: 8px;
            --radius-lg: 12px;

            --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
            --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.08);

            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }

          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: var(--text-dark);
            background-color: var(--bg-light);
            line-height: 1.6;
            transition: var(--transition);
          }

          a {
            color: var(--primary);
            text-decoration: none;
            transition: var(--transition);
          }

          a:hover {
            color: var(--primary-light);
          }

          h1, h2, h3, h4, h5, h6 {
            font-family: 'Playfair Display', serif;
            font-weight: 600;
            line-height: 1.2;
            color: var(--text-dark);
          }

          h1 {
            font-size: clamp(2rem, 5vw, 3.5rem);
            font-weight: 700;
          }

          h2 {
            font-size: clamp(1.75rem, 4vw, 2.5rem);
          }

          h3 {
            font-size: 1.5rem;
          }

          p {
            color: var(--text-light);
            font-size: 1rem;
            line-height: 1.7;
          }

          header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            background: var(--bg-light);
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(10px);
            background-color: rgba(255, 255, 255, 0.8);
            transition: var(--transition);
          }

          html.dark header {
            background-color: rgba(13, 13, 13, 0.8);
          }

          .header-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: var(--spacing-md) var(--spacing-lg);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .logo {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--primary);
          }

          .logo svg {
            width: 32px;
            height: 32px;
          }

          nav {
            display: flex;
            align-items: center;
            gap: var(--spacing-2xl);
          }

          nav a {
            font-size: 0.95rem;
            font-weight: 500;
            color: var(--text-light);
            transition: var(--transition);
          }

          nav a:hover {
            color: var(--primary);
          }

          .header-actions {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
          }

          .theme-toggle {
            background: none;
            border: none;
            cursor: pointer;
            font-size: 1.25rem;
            color: var(--text-light);
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .theme-toggle:hover {
            color: var(--primary);
          }

          .btn {
            padding: var(--spacing-sm) var(--spacing-lg);
            border: none;
            border-radius: var(--radius-lg);
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: var(--transition);
            font-family: 'Inter', sans-serif;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
          }

          .btn-primary {
            background: var(--primary);
            color: white;
            box-shadow: var(--shadow-md);
          }

          .btn-primary:hover {
            background: var(--primary-dark);
            box-shadow: var(--shadow-lg);
            transform: translateY(-2px);
          }

          .btn-secondary {
            background: transparent;
            color: var(--primary);
            border: 1.5px solid var(--primary);
          }

          .btn-secondary:hover {
            background: var(--primary);
            color: white;
          }

          .btn-lg {
            padding: 1rem 2rem;
            font-size: 1.05rem;
          }

          .btn-icon {
            padding: var(--spacing-sm) var(--spacing-md);
          }

          .btn-sm {
            padding: var(--spacing-xs) var(--spacing-md);
            font-size: 0.9rem;
          }

          main {
            margin-top: 80px;
          }

          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 var(--spacing-lg);
          }

          .section {
            padding: var(--spacing-2xl) 0;
          }

          .section-bg-alt {
            background-color: var(--bg-alt);
          }

          .hero {
            padding: calc(var(--spacing-2xl) * 1.5) 0;
            text-align: center;
          }

          .hero-content {
            max-width: 900px;
            margin: 0 auto var(--spacing-2xl);
          }

          .hero h1 {
            margin-bottom: var(--spacing-md);
            color: var(--text-dark);
          }

          .hero .subtitle {
            font-size: 1.25rem;
            color: var(--text-light);
            margin-bottom: var(--spacing-2xl);
            max-width: 700px;
            margin-left: auto;
            margin-right: auto;
          }

          .hero-cta {
            display: flex;
            flex-wrap: wrap;
            gap: var(--spacing-md);
            justify-content: center;
            margin-bottom: var(--spacing-2xl);
          }

          .hero-image {
            margin-top: var(--spacing-2xl);
            text-align: center;
          }

          .hero-image img {
            max-width: 100%;
            height: auto;
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
          }

          .trust-badges {
            display: flex;
            flex-wrap: wrap;
            gap: var(--spacing-md);
            justify-content: center;
            margin-top: var(--spacing-2xl);
            font-size: 0.9rem;
            color: var(--text-light);
          }

          .trust-badge {
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);
            padding: var(--spacing-sm) var(--spacing-md);
            background: var(--bg-alt);
            border-radius: var(--radius);
            transition: var(--transition);
          }

          .trust-badge:hover {
            background: var(--border);
          }

          .trust-badge::before {
            content: "✓";
            color: var(--success);
            font-weight: 700;
          }

          .grid {
            display: grid;
            gap: var(--spacing-lg);
            margin: var(--spacing-xl) 0;
          }

          .grid-2 {
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          }

          .grid-3 {
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          }

          .grid-4 {
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          }

          .card {
            padding: var(--spacing-lg);
            border-radius: var(--radius-lg);
            background: var(--bg-light);
            border: 1px solid var(--border);
            transition: var(--transition);
          }

          .card:hover {
            border-color: var(--primary);
            box-shadow: var(--shadow-lg);
            transform: translateY(-4px);
          }

          .card h3 {
            margin-bottom: var(--spacing-md);
            font-size: 1.25rem;
          }

          .card p {
            margin: 0;
          }

          .card-icon {
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--primary), var(--primary-light));
            border-radius: var(--radius-lg);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            margin-bottom: var(--spacing-md);
            color: white;
          }

          .problem-item {
            padding: var(--spacing-lg);
            background: var(--bg-light);
            border-left: 4px solid var(--accent);
            border-radius: var(--radius);
            transition: var(--transition);
          }

          .problem-item:hover {
            box-shadow: var(--shadow-md);
            border-left-color: var(--primary);
          }

          .problem-item h3 {
            color: var(--accent);
            margin-bottom: var(--spacing-sm);
            font-size: 1.1rem;
          }

          .steps {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: var(--spacing-lg);
            margin: var(--spacing-xl) 0;
          }

          .step {
            position: relative;
            padding: var(--spacing-lg);
            padding-left: 70px;
          }

          .step::before {
            content: attr(data-step);
            position: absolute;
            left: 0;
            top: 0;
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--primary), var(--primary-light));
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 1.25rem;
          }

          .step h3 {
            margin-bottom: var(--spacing-sm);
            font-size: 1.15rem;
          }

          .testimonial {
            padding: var(--spacing-lg);
            background: var(--bg-light);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            transition: var(--transition);
          }

          .testimonial:hover {
            border-color: var(--primary);
            box-shadow: var(--shadow-md);
          }

          .testimonial-quote {
            color: var(--text-light);
            margin-bottom: var(--spacing-md);
            font-style: italic;
            font-size: 0.95rem;
            line-height: 1.8;
          }

          .testimonial-author {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
          }

          .testimonial-avatar {
            width: 45px;
            height: 45px;
            background: linear-gradient(135deg, var(--primary), var(--primary-light));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 1.1rem;
          }

          .testimonial-info h4 {
            margin: 0;
            font-size: 0.95rem;
            font-family: 'Inter', sans-serif;
            font-weight: 600;
          }

          .testimonial-info p {
            margin: 0;
            font-size: 0.85rem;
            color: var(--text-lighter);
          }

          .comparison {
            overflow-x: auto;
            margin: var(--spacing-xl) 0;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.95rem;
          }

          thead {
            background: var(--bg-alt);
            border-bottom: 2px solid var(--border);
          }

          th, td {
            padding: var(--spacing-md);
            text-align: left;
            border-bottom: 1px solid var(--border);
          }

          th {
            font-weight: 700;
            color: var(--text-dark);
          }

          tr:last-child td {
            border-bottom: none;
          }

          .check {
            color: var(--success);
            font-weight: 700;
            font-size: 1.2rem;
          }

          .x {
            color: var(--text-lighter);
          }

          .form-container {
            max-width: 500px;
            margin: var(--spacing-xl) auto;
            padding: var(--spacing-lg);
            background: var(--bg-alt);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
          }

          .form-group {
            margin-bottom: var(--spacing-lg);
          }

          .form-group:last-child {
            margin-bottom: 0;
          }

          label {
            display: block;
            margin-bottom: var(--spacing-sm);
            font-weight: 500;
            color: var(--text-dark);
          }

          input, select, textarea {
            width: 100%;
            padding: var(--spacing-sm);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            font-family: 'Inter', sans-serif;
            font-size: 1rem;
            color: var(--text-dark);
            background: var(--bg-light);
            transition: var(--transition);
          }

          input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(13, 107, 122, 0.1);
          }

          textarea {
            resize: vertical;
            min-height: 100px;
          }

          .cta-section {
            text-align: center;
            padding: var(--spacing-2xl) 0;
          }

          .cta-section h2 {
            margin-bottom: var(--spacing-md);
          }

          .cta-section p {
            margin-bottom: var(--spacing-xl);
            font-size: 1.1rem;
            color: var(--text-light);
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
          }

          footer {
            background: var(--bg-alt);
            border-top: 1px solid var(--border);
            padding: var(--spacing-2xl) 0;
            margin-top: var(--spacing-2xl);
          }

          .footer-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: var(--spacing-lg);
            margin-bottom: var(--spacing-xl);
          }

          .footer-section h4 {
            font-size: 0.95rem;
            margin-bottom: var(--spacing-md);
            font-family: 'Inter', sans-serif;
            font-weight: 600;
          }

          .footer-section ul {
            list-style: none;
          }

          .footer-section ul li {
            margin-bottom: var(--spacing-sm);
          }

          .footer-section ul li a {
            color: var(--text-light);
            font-size: 0.9rem;
          }

          .footer-section ul li a:hover {
            color: var(--primary);
          }

          .footer-bottom {
            border-top: 1px solid var(--border);
            padding-top: var(--spacing-lg);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: var(--spacing-md);
            font-size: 0.85rem;
            color: var(--text-lighter);
          }

          .footer-bottom a {
            color: var(--text-lighter);
            font-size: 0.85rem;
          }

          .text-center {
            text-align: center;
          }

          .mb-1 { margin-bottom: var(--spacing-sm); }
          .mb-2 { margin-bottom: var(--spacing-md); }
          .mb-3 { margin-bottom: var(--spacing-lg); }
          .mb-4 { margin-bottom: var(--spacing-xl); }

          .mt-1 { margin-top: var(--spacing-sm); }
          .mt-2 { margin-top: var(--spacing-md); }
          .mt-3 { margin-top: var(--spacing-lg); }
          .mt-4 { margin-top: var(--spacing-xl); }

          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .fade-in-up {
            animation: fadeInUp 0.6s ease-out;
          }

          @media (max-width: 768px) {
            header {
              padding: var(--spacing-md);
            }

            .header-content {
              padding: var(--spacing-md);
            }

            nav {
              display: none;
            }

            .hero {
              padding: var(--spacing-xl) 0;
            }

            .hero h1 {
              font-size: 1.75rem;
            }

            .hero .subtitle {
              font-size: 1rem;
            }

            .hero-cta {
              flex-direction: column;
              align-items: center;
            }

            .btn {
              width: 100%;
              max-width: 300px;
            }

            .grid-2, .grid-3, .grid-4 {
              grid-template-columns: 1fr;
            }

            .section {
              padding: var(--spacing-xl) 0;
            }

            h2 {
              font-size: 1.5rem;
            }

            .container {
              padding: 0 var(--spacing-md);
            }

            table {
              font-size: 0.85rem;
            }

            th, td {
              padding: var(--spacing-sm);
            }

            .footer-bottom {
              flex-direction: column;
              align-items: flex-start;
            }
          }

          @media (max-width: 480px) {
            main {
              margin-top: 70px;
            }

            .header-content {
              padding: var(--spacing-sm);
            }

            .logo {
              font-size: 1rem;
              gap: var(--spacing-xs);
            }

            .logo svg {
              width: 24px;
              height: 24px;
            }

            .header-actions {
              gap: var(--spacing-sm);
            }

            h1 {
              font-size: 1.5rem;
            }

            h2 {
              font-size: 1.25rem;
            }

            h3 {
              font-size: 1.1rem;
            }

            .hero .subtitle {
              font-size: 0.95rem;
            }

            .trust-badges {
              gap: var(--spacing-sm);
              flex-direction: column;
              align-items: center;
            }

            .step {
              padding-left: 60px;
            }

            .step::before {
              width: 45px;
              height: 45px;
              font-size: 1.1rem;
            }

            .form-container {
              padding: var(--spacing-md);
            }
          }
        `}</style>
      </head>
      <body>
        <header>
          <div className="header-content">
            <motion.div
              className="logo"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="8" fill="currentColor" opacity="0.1"/>
                <path d="M16 8C11.58 8 8 11.58 8 16s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8m0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6m3-9h-3V11h-2v4h-3v2h3v3h2v-3h3v-2z" fill="currentColor"/>
              </svg>
              <span>AgendaClinic</span>
            </motion.div>

            <nav>
              {['Problemas', 'Solução', 'Benefícios', 'Depoimentos'].map((item, i) => (
                <motion.a
                  key={item}
                  href={`#${item.toLowerCase().replace('ç', 'c').replace('õ', 'o')}`}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.1 }}
                >
                  {item}
                </motion.a>
              ))}
            </nav>

            <div className="header-actions">
              <motion.button
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label="Alternar tema"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                {isDarkMode ? '☀️' : '🌙'}
              </motion.button>
              <motion.a
                href="https://app.agendaclinic.com/login"
                className="btn btn-secondary btn-sm"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Entrar
              </motion.a>
              <motion.button
                className="btn btn-primary btn-icon"
                onClick={() => document.getElementById('demo-form')?.scrollIntoView({ behavior: 'smooth' })}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Agendar Demo
              </motion.button>
            </div>
          </div>
        </header>

        <main>
          {/* Hero Section */}
          <section className="hero">
            <motion.div
              style={{ opacity: heroOpacity, y: heroY }}
              className="container"
            >
              <div className="hero-content">
                <motion.h1
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                >
                  Seu consultório merecia estar organizado.<br/>Agora pode estar em 48 horas.
                </motion.h1>
                <motion.p
                  className="subtitle"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
                >
                  Enquanto você lê isso, 500+ clínicas já estão usando AgendaClinic para eliminar faltas de pacientes, libertar a recepção e ganhar 5h por semana. Você está fora dessa?
                </motion.p>
              </div>

              <motion.div
                className="hero-cta"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <motion.button
                  className="btn btn-primary btn-lg"
                  onClick={() => document.getElementById('demo-form')?.scrollIntoView({ behavior: 'smooth' })}
                  variants={itemVariants}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Testar Grátis por 14 Dias
                </motion.button>
                <motion.a
                  href="https://wa.me/5511999999999"
                  className="btn btn-secondary btn-lg"
                  variants={itemVariants}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Falar no WhatsApp
                </motion.a>
              </motion.div>

              <motion.div
                className="hero-image"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
              >
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 400' width='100%' height='auto'%3E%3Crect width='800' height='400' fill='%23f8f7f5'/%3E%3Crect x='50' y='50' width='700' height='300' rx='8' fill='white' stroke='%23e8e8e8' stroke-width='2'/%3E%3Crect x='70' y='70' width='660' height='40' fill='%230d6b7a' opacity='0.1' rx='4'/%3E%3Crect x='70' y='130' width='300' height='20' fill='%230d6b7a' opacity='0.2' rx='2'/%3E%3Crect x='70' y='160' width='250' height='120' fill='%230d6b7a' opacity='0.05' rx='4'/%3E%3Crect x='430' y='130' width='300' height='150' fill='%232d8a6b' opacity='0.1' rx='4'/%3E%3C/svg%3E" alt="Interface do sistema de agendamento" />
              </motion.div>

              <motion.div
                className="trust-badges"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {['Confirmação Automática', 'Agenda Organizada', 'Atendimento Ágil'].map((badge) => (
                  <motion.div
                    key={badge}
                    className="trust-badge"
                    variants={itemVariants}
                    whileHover={{ scale: 1.05 }}
                  >
                    {badge}
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          </section>

          {/* Problems Section */}
          <section id="problemas" className="section section-bg-alt">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Seu consultório está deixando dinheiro na mesa todos os dias?
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Reconheça os problemas que custam receita, confiança de pacientes e sanidade da sua equipe.
              </motion.p>

              <motion.div
                className="grid grid-2"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  { title: 'Recepção Sobrecarregada', desc: 'Sua recepcionista atende o mesmo paciente 3, 4, 5 vezes confirmando consulta. Enquanto outras ligações esperam. Estresse = rotatividade = mais custos.' },
                  { title: 'Pacientes Não Aparecem', desc: 'Até 30% de faltas significa: agenda para 20 pacientes funciona como para 14. Consultório vazio. Receita de até R$ 5.000/mês desaparecendo.' },
                  { title: 'Agenda Desorganizada', desc: 'Whatsapp, anotações, papel, planilha Excel. Ninguém sabe realmente quantos horários estão livres. Duplas marcações. Pacientes furiosos.' },
                  { title: 'Tempo Perdido em Atendimento', desc: 'Responder mensagens é 40% do tempo da recepção. Seu consultório é eficiente? Ou é um call center com médicos?' },
                ].map((item) => (
                  <motion.div
                    key={item.title}
                    className="problem-item"
                    variants={itemVariants}
                    whileHover={{ borderLeftColor: 'var(--primary)', y: -5 }}
                  >
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* Solution Section */}
          <section id="solucao" className="section">
            <div className="container">
              <div style={{maxWidth: '800px', margin: '0 auto'}}>
                <motion.h2
                  className="text-center mb-3"
                  variants={titleVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-100px' }}
                >
                  Como o AgendaClinic Resolve Tudo Isso
                </motion.h2>
                <motion.p
                  className="text-center"
                  style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  viewport={{ once: true, margin: '-100px' }}
                >
                  Um painel único e inteligente que centraliza atendimento, automatiza confirmações e organiza completamente a sua agenda.
                </motion.p>
              </div>

              <motion.div
                className="grid grid-3 mb-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  {
                    icon: '📱',
                    title: 'Um Painel. Sem Caos.',
                    desc: 'ANTES: WhatsApp + Ligações + Anotações = Mensagens perdidas, pacientes irritados.\nDEPOIS: Um painel. Um clique. Tudo registrado. Nenhuma mensagem se perde.'
                  },
                  {
                    icon: '🤖',
                    title: 'Confirmação em Piloto Automático',
                    desc: 'ANTES: Recepcionista liga/envia 20 mensagens por dia.\nDEPOIS: Sistema envia. Pacientes confirmam. 95% confirmação. Recepção respira.'
                  },
                  {
                    icon: '💰',
                    title: 'Seu Dinheiro Volta',
                    desc: 'ANTES: 30% de faltas = 5 consultórios vazios por semana = até R$ 5.000/mês perdidos.\nDEPOIS: 95% confirmação = 5h/semana ganhas + receita previsível.'
                  },
                ].map((item) => (
                  <motion.div
                    key={item.title}
                    className="card"
                    variants={cardVariants}
                    whileHover="hover"
                  >
                    <div className="card-icon">{item.icon}</div>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* How It Works */}
          <section className="section section-bg-alt">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Como Você Ganha 5h Por Semana (Em 4 Passos)
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Do primeiro contato do paciente até sua equipe controlar tudo — sem nenhuma ligação de confirmação.
              </motion.p>

              <div className="steps">
                {[
                  { step: 1, title: 'Paciente Entra em Contato', desc: 'Via WhatsApp, formulário ou ligação. Tudo é registrado automaticamente no sistema.' },
                  { step: 2, title: 'Escolhe o Horário', desc: 'Visualiza horários disponíveis em tempo real e escolhe o que melhor se adequa.' },
                  { step: 3, title: 'Recebe Confirmação', desc: 'Lembretes automáticos 24h e 2h antes da consulta. Taxa de confirmação sobe para 95%.' },
                  { step: 4, title: 'Sua Equipe Controla Tudo', desc: 'Painel centralizado com agenda, confirmações, perfil de cada paciente e histórico completo.' },
                ].map((item, i) => (
                  <motion.div
                    key={item.step}
                    className="step"
                    data-step={item.step}
                    variants={stepVariants}
                    custom={i}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-100px' }}
                  >
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Benefits Section */}
          <section id="beneficios" className="section">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Resultados Que Você Pode Esperar
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Ganhos concretos e mensuráveis que impactam diretamente na saúde financeira da sua clínica.
              </motion.p>

              <motion.div
                className="grid grid-2 mb-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  { number: '−60%', label: 'Redução de faltas de pacientes' },
                  { number: '+5h', label: 'Horas economizadas por semana na recepção' },
                  { number: '+40%', label: 'Mais agendamentos convertidos' },
                  { number: '95%', label: 'Taxa de confirmação de pacientes' },
                ].map((item) => (
                  <motion.div
                    key={item.number}
                    style={{padding: 'var(--spacing-lg)', background: 'linear-gradient(135deg, var(--primary), var(--primary-light))', borderRadius: 'var(--radius-lg)', color: 'white'}}
                    variants={cardVariants}
                    whileHover="hover"
                  >
                    <h3 style={{color: 'white', fontSize: '2.5rem', marginBottom: 'var(--spacing-sm)'}}>{item.number}</h3>
                    <p style={{color: 'rgba(255,255,255,0.9)'}}>{item.label}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* For Whom */}
          <section className="section section-bg-alt">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Para Quem é o AgendaClinic
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Qualquer profissional ou clínica que receba pacientes pode se beneficiar.
              </motion.p>

              <motion.div
                className="grid grid-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  { icon: '🏥', title: 'Clínicas Médicas', desc: 'Cardiologia, oftalmologia, dermatologia e qualquer especialidade.' },
                  { icon: '🦷', title: 'Consultórios Odontológicos', desc: 'Reduz faltas e organiza a agenda de múltiplos dentistas.' },
                  { icon: '💄', title: 'Clínicas de Estética', desc: 'Controla disponibilidade de profissionais e serviços.' },
                  { icon: '🧠', title: 'Psicólogos', desc: 'Lembretes automáticos aumentam confirmação de sessões.' },
                  { icon: '🏃', title: 'Fisioterapeutas', desc: 'Gerencie múltiplos pacientes com suas sessões.' },
                  { icon: '💉', title: 'Vacinação', desc: 'Organiza fila de espera e confirma comparecimento.' },
                  { icon: '🏠', title: 'Home Care', desc: 'Controla visitas domiciliares e disponibilidade.' },
                  { icon: '👨‍⚕️', title: 'Consultórios Particulares', desc: 'Para qualquer profissional que atenda por agendamento.' },
                ].map((item) => (
                  <motion.div
                    key={item.title}
                    className="card"
                    variants={cardVariants}
                    whileHover="hover"
                  >
                    <h3 style={{fontSize: '1rem'}}>{item.icon} {item.title}</h3>
                    <p style={{fontSize: '0.9rem'}}>{item.desc}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* Social Proof */}
          <section id="depoimentos" className="section">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                O Que Dizem Sobre Nós
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Profissionais e clínicas já transformaram seu atendimento com AgendaClinic.
              </motion.p>

              <motion.div
                className="grid grid-3"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  {
                    quote: 'Antes: 15 ligações/dia confirmar. 25% de faltas. Depois: Sistema automático. 95% confirmação. Ganho 5h/semana. A recepcionista agora tem tempo para atender bem — não apenas confirmar. Paguei a mensalidade em uma semana.',
                    initials: 'DR',
                    name: 'Dra. Roberta Silva',
                    role: 'Cardiologista em SP',
                    metrics: 'De 15 ligações → 0 | De 60 para 85 pacientes/mês'
                  },
                  {
                    quote: 'Não acreditava que era possível reduzir faltas assim. Implementei segunda-feira. Quinta já vi diferença. Menos consultórios vazios, mais receita previsível. A equipe está feliz — não é mais telefone o tempo todo.',
                    initials: 'CV',
                    name: 'Carlos Ventura',
                    role: 'Dentista em MG',
                    metrics: 'De 30% para 5% de faltas | +R$ 3.200/mês'
                  },
                  {
                    quote: 'O painel está tão simples que minha secretária aprendeu em 20 minutos. Pacientes confirmam sozinhos. Evita aquele constrangimento de ligar perguntando se vem. Resultado? Ganho de tempo e confiança do paciente.',
                    initials: 'FO',
                    name: 'Fernanda Oliveira',
                    role: 'Clínica de Estética em RJ',
                    metrics: 'De 8h → 3h/semana confirmações | Pacientes mais satisfeitos'
                  },
                ].map((item) => (
                  <motion.div
                    key={item.name}
                    className="testimonial"
                    variants={cardVariants}
                    whileHover="hover"
                  >
                    <div className="testimonial-quote">
                      "{item.quote}"
                    </div>
                    {item.metrics && (
                      <div style={{
                        background: 'var(--primary)',
                        color: 'white',
                        padding: 'var(--spacing-sm) var(--spacing-md)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        marginBottom: 'var(--spacing-md)'
                      }}>
                        📊 {item.metrics}
                      </div>
                    )}
                    <div className="testimonial-author">
                      <div className="testimonial-avatar">{item.initials}</div>
                      <div className="testimonial-info">
                        <h4>{item.name}</h4>
                        <p>{item.role}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>

          {/* Comparison */}
          <section className="section section-bg-alt">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Comparação: Antes vs. Depois
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Entenda a diferença de usar o AgendaClinic em relação ao método manual.
              </motion.p>

              <motion.div
                className="comparison"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Processo</th>
                      <th>Atendimento Manual</th>
                      <th>Com AgendaClinic</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>Confirmação de Consulta</strong></td>
                      <td>Recepcionista liga ou envia mensagem (manual)</td>
                      <td>Sistema envia automaticamente <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Taxa de Confirmação</strong></td>
                      <td>50-60%</td>
                      <td>95%+ <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Tempo na Recepção</strong></td>
                      <td>5-8h por semana em confirmações</td>
                      <td>Liberado para outras tarefas <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Agendamento pelo Paciente</strong></td>
                      <td>Precisa de atendente disponível <span className="x">✗</span></td>
                      <td>Disponível 24/7 <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Histórico do Paciente</strong></td>
                      <td>Espalhado em várias anotações <span className="x">✗</span></td>
                      <td>Centralizado e organizado <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Visão da Agenda</strong></td>
                      <td>Múltiplos sistemas e papéis <span className="x">✗</span></td>
                      <td>Um painel claro e simples <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Resposta a Dúvidas</strong></td>
                      <td>Demora para atender <span className="x">✗</span></td>
                      <td>Respostas automáticas imediatas <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <td><strong>Relatórios e Análise</strong></td>
                      <td>Difícil de mensurar <span className="x">✗</span></td>
                      <td>Relatórios automáticos <span className="check">✓</span></td>
                    </tr>
                  </tbody>
                </table>
              </motion.div>
            </div>
          </section>

          {/* Pricing Section */}
          <section className="section">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Planos Simples e Transparentes
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Escolha o plano que melhor se adequa ao tamanho e necessidade da sua clínica.
              </motion.p>

              <motion.div
                className="grid grid-3"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
                style={{marginBottom: 'var(--spacing-2xl)'}}
              >
                {[
                  {
                    name: 'Básico',
                    price: 'R$ 199',
                    period: '/mês',
                    desc: 'Para consultórios pequenos e independentes',
                    features: [
                      'Até 5 profissionais',
                      'Agenda para 500+ pacientes',
                      'Confirmação automática básica',
                      'Suporte por email',
                      'Relatórios simples'
                    ],
                    cta: 'Começar Agora',
                    highlighted: false
                  },
                  {
                    name: 'Profissional',
                    price: 'R$ 499',
                    period: '/mês',
                    desc: 'Para clínicas e consultórios em crescimento',
                    features: [
                      'Até 20 profissionais',
                      'Agenda para 5.000+ pacientes',
                      'Confirmação automática avançada',
                      'Suporte por WhatsApp e email',
                      'Relatórios detalhados',
                      'Integração com WhatsApp Business'
                    ],
                    cta: 'Escolher Plano',
                    highlighted: true
                  },
                  {
                    name: 'Enterprise',
                    price: 'Sob Consulta',
                    period: '',
                    desc: 'Para redes e grandes clínicas',
                    features: [
                      'Profissionais ilimitados',
                      'Pacientes ilimitados',
                      'Confirmação automática com IA',
                      'Suporte prioritário 24/7',
                      'Relatórios avançados e BI',
                      'Integrações customizadas',
                      'Dedicado exclusivo'
                    ],
                    cta: 'Falar com Vendas',
                    highlighted: false
                  }
                ].map((plan) => (
                  <motion.div
                    key={plan.name}
                    className="card"
                    variants={cardVariants}
                    whileHover="hover"
                    style={{
                      border: plan.highlighted ? '2px solid var(--primary)' : '1px solid var(--border)',
                      background: plan.highlighted ? 'linear-gradient(135deg, var(--primary), var(--primary-light))' : 'var(--card-bg)',
                      color: plan.highlighted ? 'white' : 'inherit'
                    }}
                  >
                    {plan.highlighted && (
                      <div style={{
                        display: 'inline-block',
                        background: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        marginBottom: 'var(--spacing-md)',
                        textTransform: 'uppercase'
                      }}>
                        ⭐ Recomendado
                      </div>
                    )}
                    <h3 style={{color: plan.highlighted ? 'white' : 'inherit'}}>{plan.name}</h3>
                    <p style={{color: plan.highlighted ? 'rgba(255,255,255,0.9)' : 'var(--text-light)'}}>{plan.desc}</p>

                    <div style={{
                      margin: 'var(--spacing-lg) 0',
                      paddingBottom: 'var(--spacing-lg)',
                      borderBottom: plan.highlighted ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border)'
                    }}>
                      <div style={{
                        fontSize: '2.5rem',
                        fontWeight: '700',
                        color: plan.highlighted ? 'white' : 'var(--primary)',
                      }}>
                        {plan.price}
                      </div>
                      {plan.period && (
                        <div style={{
                          color: plan.highlighted ? 'rgba(255,255,255,0.8)' : 'var(--text-light)',
                          fontSize: '0.9rem'
                        }}>
                          {plan.period}
                        </div>
                      )}
                    </div>

                    <ul style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 'var(--spacing-lg) 0',
                      flex: 1
                    }}>
                      {plan.features.map((feature, i) => (
                        <li key={i} style={{
                          padding: 'var(--spacing-sm) 0',
                          color: plan.highlighted ? 'rgba(255,255,255,0.9)' : 'inherit'
                        }}>
                          ✓ {feature}
                        </li>
                      ))}
                    </ul>

                    <motion.button
                      className="btn"
                      style={{
                        width: '100%',
                        background: plan.highlighted ? 'white' : 'var(--primary)',
                        color: plan.highlighted ? 'var(--primary)' : 'white',
                        marginTop: 'var(--spacing-md)'
                      }}
                      onClick={() => {
                        if (plan.name === 'Enterprise') {
                          window.open('https://wa.me/5511999999999?text=' + encodeURIComponent('Olá! Gostaria de saber mais sobre o plano Enterprise do AgendaClinic.'), '_blank');
                        } else {
                          document.getElementById('demo-form')?.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {plan.cta}
                    </motion.button>
                  </motion.div>
                ))}
              </motion.div>

              <motion.div
                className="text-center"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                <div style={{background: 'rgba(13, 107, 122, 0.1)', padding: 'var(--spacing-lg)', borderRadius: 'var(--radius-lg)', marginBottom: 'var(--spacing-lg)'}}>
                  <p style={{color: 'var(--primary)', fontWeight: '600', marginBottom: 'var(--spacing-sm)'}}>
                    ⏰ Oferta por Tempo Limitado
                  </p>
                  <p style={{color: 'var(--text-dark)', marginBottom: 0}}>
                    <strong>Primeiros 30 clientes:</strong> 30% de desconto pelos primeiros 3 meses
                  </p>
                </div>
                <p style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-sm)', fontSize: '0.95rem'}}>
                  ✅ Sem cartão de crédito | ✅ 14 dias grátis | ✅ Cancele quando quiser
                </p>
                <p style={{color: 'var(--primary)', fontWeight: '600', marginBottom: 0}}>
                  ✅ Garantia 100%: Se não gostar, devolvemos seu dinheiro
                </p>
              </motion.div>
            </div>
          </section>

          {/* Final CTA */}
          <section id="demo-form" className="cta-section">
            <div className="container">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Comece em 48 Horas. Sem Cartão. Sem Risco.
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Teste o AgendaClinic gratuitamente por 14 dias. Veja seus pacientes confirmando sozinhos. Se não gostar, cancelamos — sem perguntas, sem burocracia.
              </motion.p>

              <motion.div
                className="form-container"
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                <form onSubmit={handleFormSubmit}>
                  <div className="form-group">
                    <label htmlFor="name">Seu Nome *</label>
                    <input type="text" id="name" name="name" required placeholder="João Silva" />
                  </div>

                  <div className="form-group">
                    <label htmlFor="clinic">Nome da Clínica/Consultório *</label>
                    <input type="text" id="clinic" name="clinic" required placeholder="Clínica de Cardiologia Silva" />
                  </div>

                  <div className="form-group">
                    <label htmlFor="specialty">Especialidade *</label>
                    <select id="specialty" name="specialty" required>
                      <option value="">Selecione uma especialidade</option>
                      <option value="medicina-geral">Medicina Geral</option>
                      <option value="cardiologia">Cardiologia</option>
                      <option value="odontologia">Odontologia</option>
                      <option value="estetica">Estética</option>
                      <option value="psicologia">Psicologia</option>
                      <option value="fisioterapia">Fisioterapia</option>
                      <option value="oftalmologia">Oftalmologia</option>
                      <option value="dermatologia">Dermatologia</option>
                      <option value="outra">Outra</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="whatsapp">WhatsApp para Contato *</label>
                    <input type="tel" id="whatsapp" name="whatsapp" required placeholder="(11) 99999-9999" />
                  </div>

                  <div className="form-group">
                    <label htmlFor="message">Como podemos ajudar? (Opcional)</label>
                    <textarea id="message" name="message" placeholder="Conte-nos mais sobre os desafios da sua clínica..."></textarea>
                  </div>

                  <motion.button
                    type="submit"
                    className="btn btn-primary"
                    style={{width: '100%'}}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Começar Teste Gratuito Agora
                  </motion.button>

                  <p style={{marginTop: 'var(--spacing-md)', fontSize: '0.85rem', color: 'var(--text-lighter)', textAlign: 'center', marginBottom: 'var(--spacing-sm)'}}>
                    ✓ Sem cartão | ✓ Sem compromisso | ✓ Resposta em até 2h
                  </p>
                  <p style={{fontSize: '0.8rem', color: 'var(--text-lighter)', textAlign: 'center', marginBottom: 0}}>
                    Entre em contato via WhatsApp — conversamos sobre sua clínica e fazemos setup em 48h.
                  </p>
                </form>
              </motion.div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer>
          <div className="container">
            <div className="footer-content">
              <div className="footer-section">
                <h4>AgendaClinic</h4>
                <p style={{fontSize: '0.9rem', color: 'var(--text-light)', margin: 0}}>
                  A plataforma mais inteligente para gerenciar agendamentos de clínicas e consultórios.
                </p>
              </div>

              <div className="footer-section">
                <h4>Produto</h4>
                <ul>
                  <li><a href="#solucao">Como Funciona</a></li>
                  <li><a href="#beneficios">Benefícios</a></li>
                  <li><a href="#depoimentos">Depoimentos</a></li>
                </ul>
              </div>

              <div className="footer-section">
                <h4>Suporte</h4>
                <ul>
                  <li><a href="https://wa.me/5511999999999">WhatsApp</a></li>
                  <li><a href="mailto:hello@agendaclinic.com">Email</a></li>
                  <li><a href="#">Central de Ajuda</a></li>
                </ul>
              </div>

              <div className="footer-section">
                <h4>Legal</h4>
                <ul>
                  <li><a href="#">Termos de Uso</a></li>
                  <li><a href="#">Política de Privacidade</a></li>
                  <li><a href="#">LGPD</a></li>
                </ul>
              </div>
            </div>

            <div className="footer-bottom">
              <div>
                © 2024 AgendaClinic. Todos os direitos reservados.
              </div>
              <div>
                Feito para clínicas que buscam organização e profissionalismo
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
