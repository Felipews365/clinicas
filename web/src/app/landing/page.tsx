'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { LandingPricingSection } from '@/components/landing-pricing-section';

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
    transition: { duration: 0.6, ease: 'easeOut' as const },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' as const },
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
      ease: 'easeOut' as const,
    },
  }),
};

const titleVariants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: 'easeOut' as const },
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

  const urgencyDeadline = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return new Intl.DateTimeFormat("pt-BR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
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
        <title>Menos faltas na agenda em 48h | AgendaClinic</title>
        <meta name="description" content="Para donos de clínica e consultório: confirmação automática, agenda única e receção livre de ligações repetidas. Em 48h você sai do caos de WhatsApp + planilha." />
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
            --primary-light: #2ad4e8;
            --accent: #e5484d;
            --text-dark: #fafafa;
            --text-light: #c5d0d2;
            --text-lighter: #8a9b9e;
            --bg-light: #0a0e10;
            --bg-alt: #121a1c;
            --border: #2a3538;
            --success: #3dcf9a;
            --spotlight: rgba(26, 141, 158, 0.14);
            --card-elevated: rgba(18, 30, 34, 0.92);
          }

          .hero.spotlight-hero {
            position: relative;
            overflow: hidden;
            background-color: var(--bg-light);
            min-height: min(720px, 92vh);
          }

          .hero.spotlight-hero::before {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            background-image: url('/landing/hero-reception.webp');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            pointer-events: none;
          }

          html.dark .hero.spotlight-hero::after {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
              radial-gradient(ellipse 85% 70% at 50% -15%, var(--spotlight) 0%, transparent 55%),
              linear-gradient(180deg, rgba(10, 14, 16, 0.50) 0%, rgba(10, 14, 16, 0.58) 45%, rgba(10, 14, 16, 0.65) 100%);
          }

          html.light .hero.spotlight-hero::after {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.45) 0%, rgba(248, 247, 245, 0.52) 45%, rgba(255, 255, 255, 0.58) 100%);
          }

          .hero.spotlight-hero > .container {
            position: relative;
            z-index: 1;
          }

          .text-spotlight {
            color: var(--text-dark);
            text-shadow: 0 0 40px rgba(42, 212, 232, 0.08);
          }

          html.dark .hero .subtitle {
            color: #b8c9cc;
          }

          .btn-glow-primary {
            box-shadow: 0 4px 24px rgba(13, 107, 122, 0.45), 0 0 0 1px rgba(42, 212, 232, 0.25);
          }

          html.light .btn-glow-primary {
            box-shadow: 0 4px 20px rgba(13, 107, 122, 0.35);
          }

          .btn-ghost-spotlight {
            background: transparent;
            color: var(--primary-light);
            border: 2px solid rgba(26, 141, 158, 0.65);
          }

          html.dark .btn-ghost-spotlight {
            color: #e8f4f6;
            border-color: rgba(232, 244, 246, 0.35);
          }

          html.dark .btn-ghost-spotlight:hover {
            background: rgba(26, 141, 158, 0.15);
            color: #fff;
          }

          .social-proof-bar {
            padding: 1.25rem 0 2rem;
            border-bottom: 1px solid var(--border);
            margin-bottom: var(--spacing-xl);
          }

          .social-proof-inner {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 1rem 1.75rem;
          }

          .social-proof-text {
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--text-dark);
            letter-spacing: 0.02em;
          }

          .social-proof-avatars {
            display: flex;
            align-items: center;
          }

          .social-proof-avatars span {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            margin-left: -10px;
            border: 2px solid var(--bg-light);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.65rem;
            font-weight: 700;
            color: #fff;
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
          }

          .social-proof-avatars span:first-child { margin-left: 0; }

          .section-tight {
            padding: 3rem 0;
          }

          .section-loose {
            padding: 5rem 0;
          }

          .section-rhythm {
            padding: 3.75rem 0;
          }

          .solution-asymmetric {
            display: grid;
            grid-template-columns: 1.25fr 1fr;
            gap: var(--spacing-xl);
            align-items: stretch;
          }

          @media (max-width: 900px) {
            .solution-asymmetric { grid-template-columns: 1fr; }
          }

          .solution-main-panel {
            padding: var(--spacing-xl);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            background: var(--bg-alt);
          }

          html.dark .solution-main-panel {
            background: var(--card-elevated);
            border-color: rgba(42, 212, 232, 0.12);
            box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
          }

          .solution-side-panel {
            padding: var(--spacing-lg);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            background: linear-gradient(165deg, rgba(13, 107, 122, 0.18), transparent);
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          .solution-gain-list {
            list-style: none;
            margin: var(--spacing-md) 0 0;
            padding: 0;
          }

          .solution-gain-list li {
            padding: 0.65rem 0;
            padding-left: 1.5rem;
            position: relative;
            color: var(--text-light);
            border-bottom: 1px solid var(--border);
          }

          .solution-gain-list li:last-child { border-bottom: none; }

          .solution-gain-list li::before {
            content: "→";
            position: absolute;
            left: 0;
            color: var(--primary-light);
            font-weight: 700;
          }

          .stats-mega {
            padding: var(--spacing-xl) var(--spacing-lg);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border);
            background: linear-gradient(180deg, var(--bg-alt) 0%, var(--bg-light) 100%);
          }

          html.dark .stats-mega {
            background: linear-gradient(180deg, #0f1619 0%, #0a1012 100%);
            border-color: rgba(42, 212, 232, 0.15);
          }

          .stats-mega-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: var(--spacing-xl) var(--spacing-md);
          }

          @media (min-width: 769px) {
            .stats-mega-grid { grid-template-columns: repeat(4, 1fr); gap: var(--spacing-lg); }
          }

          .stats-mega-item {
            text-align: center;
          }

          .stats-mega-number {
            font-family: 'Playfair Display', serif;
            font-size: clamp(2.75rem, 8vw, 5.25rem);
            font-weight: 700;
            line-height: 1.05;
            background: linear-gradient(135deg, #fff 0%, var(--primary-light) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          html.light .stats-mega-number {
            background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-light) 100%);
            -webkit-background-clip: text;
            background-clip: text;
          }

          .stats-mega-label {
            margin-top: 0.75rem;
            font-size: 0.9rem;
            font-weight: 500;
            color: var(--text-light);
            max-width: 12rem;
            margin-left: auto;
            margin-right: auto;
          }

          .comparison table col.col-manual { width: 32%; }
          .comparison table col.col-ac { width: 38%; }

          .comparison th.th-manual,
          .comparison td.td-manual {
            background: var(--bg-alt);
            color: var(--text-lighter);
            font-weight: 400;
          }

          .comparison th.th-ac,
          .comparison td.td-ac {
            background: linear-gradient(180deg, rgba(13, 107, 122, 0.35) 0%, rgba(13, 107, 122, 0.22) 100%);
            color: var(--text-dark);
            font-weight: 600;
            border-left: 3px solid var(--primary-light);
          }

          html.light .comparison th.th-ac,
          html.light .comparison td.td-ac {
            background: linear-gradient(180deg, #0d6b7a 0%, #155e6b 100%);
            color: #fff;
          }

          html.light .comparison th.th-ac .check,
          html.light .comparison td.td-ac { color: rgba(255,255,255,0.95); }

          .faq-section details {
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            margin-bottom: var(--spacing-sm);
            background: var(--bg-alt);
            overflow: hidden;
          }

          .faq-section summary {
            padding: var(--spacing-md) var(--spacing-lg);
            cursor: pointer;
            font-weight: 600;
            color: var(--text-dark);
            list-style: none;
          }

          .faq-section summary::-webkit-details-marker { display: none; }

          .faq-section details[open] summary {
            border-bottom: 1px solid var(--border);
          }

          .faq-section details p {
            padding: var(--spacing-md) var(--spacing-lg);
            margin: 0;
            font-size: 0.95rem;
            color: var(--text-light);
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

          tr:last-child th,
          tr:last-child td {
            border-bottom: none;
          }

          .comparison tbody th {
            font-weight: 600;
            color: var(--text-dark);
            background: var(--bg-light);
            width: 22%;
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
              {[
                { label: 'Problemas', href: '#problemas' },
                { label: 'Solução', href: '#solucao' },
                { label: 'Como funciona', href: '#passos' },
                { label: 'Resultados', href: '#beneficios' },
                { label: 'Depoimentos', href: '#depoimentos' },
                { label: 'FAQ', href: '#faq' },
              ].map((item, i) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.08 }}
                >
                  {item.label}
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
                href="/login"
                className="btn btn-secondary btn-sm"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Entrar
              </motion.a>
              <motion.button
                className="btn btn-primary btn-icon btn-glow-primary"
                onClick={() => document.getElementById('demo-form')?.scrollIntoView({ behavior: 'smooth' })}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Testar grátis 7 dias
              </motion.button>
            </div>
          </div>
        </header>

        <main>
          {/* Hero Section */}
          <section className="hero spotlight-hero">
            <motion.div
              style={{ opacity: heroOpacity, y: heroY }}
              className="container"
            >
              <div className="hero-content">
                <motion.h1
                  className="text-spotlight"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: 'easeOut' as const }}
                >
                  Corte faltas e ligações repetidas na sua agenda
                </motion.h1>
                <motion.p
                  className="subtitle"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' as const }}
                >
                  <strong>Para quem:</strong> donos de clínica ou consultório que ainda espalham agenda entre WhatsApp, papel e planilha — e uma receção que vive ao telefone.
                  <br /><br />
                  <strong>Em 48 horas você ganha:</strong> um painel único, confirmações a correr sem caça às mensagens, e horários claros para a equipa e para o paciente.
                </motion.p>
              </div>

              <motion.div
                className="hero-cta"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <motion.button
                  type="button"
                  className="btn btn-primary btn-lg btn-glow-primary"
                  onClick={() => document.getElementById('demo-form')?.scrollIntoView({ behavior: 'smooth' })}
                  variants={itemVariants}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Testar grátis 7 dias
                </motion.button>
                <motion.a
                  href="#passos"
                  className="btn btn-secondary btn-lg btn-ghost-spotlight"
                  variants={itemVariants}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Ver como funciona
                </motion.a>
              </motion.div>

              <motion.div
                className="social-proof-bar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.35 }}
              >
                <div className="social-proof-inner">
                  <p className="social-proof-text">Usado por +500 clínicas no Brasil</p>
                  <div className="social-proof-avatars" aria-hidden>
                    {['CM', 'LP', 'AS', 'RK', 'TG', 'NV'].map((c, i) => (
                      <span key={i}>{c}</span>
                    ))}
                  </div>
                </div>
              </motion.div>

              <motion.div
                className="hero-image"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' as const }}
              >
                {/* Dashboard mockup */}
                <div style={{
                  background: 'rgba(255,255,255,0.92)',
                  backdropFilter: 'blur(12px)',
                  borderRadius: '16px',
                  border: '1px solid rgba(13,107,122,0.15)',
                  boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 4px 16px rgba(13,107,122,0.12)',
                  overflow: 'hidden',
                  width: '100%',
                  fontFamily: 'var(--font-geist-sans, sans-serif)',
                }}>
                  {/* Topbar */}
                  <div style={{
                    background: '#0d6b7a',
                    padding: '10px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg viewBox="0 0 16 16" fill="white" style={{ width: '14px', height: '14px' }}><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
                      </div>
                      <span style={{ color: 'white', fontWeight: 600, fontSize: '13px', letterSpacing: '-0.01em' }}>AgendaClinic</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px' }}>Seg, 07 Abr 2026</span>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>DR</span>
                      </div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', borderBottom: '1px solid #e8f0f1' }}>
                    {[
                      { label: 'Hoje', value: '14', sub: 'consultas', color: '#0d6b7a' },
                      { label: 'Confirmados', value: '11', sub: '79%', color: '#2d8a6b' },
                      { label: 'Pendentes', value: '3', sub: 'aguardando', color: '#e08a00' },
                      { label: 'Faltas hoje', value: '0', sub: '−60% vs ant.', color: '#16a34a' },
                    ].map((stat, i) => (
                      <div key={i} style={{
                        padding: '10px 14px',
                        borderRight: i < 3 ? '1px solid #e8f0f1' : 'none',
                      }}>
                        <p style={{ margin: 0, fontSize: '10px', color: '#6b8a8f', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</p>
                        <p style={{ margin: '2px 0 0', fontSize: '22px', fontWeight: 700, color: stat.color, lineHeight: 1 }}>{stat.value}</p>
                        <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#9ab0b4' }}>{stat.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* Main content: calendar + list */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', minHeight: '220px' }}>
                    {/* Calendar grid */}
                    <div style={{ padding: '12px 14px', borderRight: '1px solid #e8f0f1' }}>
                      {/* Day headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: '38px repeat(5, 1fr)', gap: '4px', marginBottom: '6px' }}>
                        <div />
                        {['Seg 7', 'Ter 8', 'Qua 9', 'Qui 10', 'Sex 11'].map((d, i) => (
                          <div key={i} style={{
                            textAlign: 'center', fontSize: '10px', fontWeight: i === 0 ? 700 : 500,
                            color: i === 0 ? '#0d6b7a' : '#9ab0b4',
                            background: i === 0 ? 'rgba(13,107,122,0.08)' : 'transparent',
                            borderRadius: '6px', padding: '3px 0',
                          }}>{d}</div>
                        ))}
                      </div>
                      {/* Hour rows */}
                      {[
                        { hour: '08:00', slots: [{ col: 0, label: 'M. Santos', color: '#0d6b7a' }, { col: 2, label: 'R. Lima', color: '#2d8a6b' }] },
                        { hour: '09:00', slots: [{ col: 0, label: 'C. Ferreira', color: '#0d6b7a' }, { col: 1, label: 'P. Alves', color: '#7c3aed' }, { col: 4, label: 'J. Costa', color: '#2d8a6b' }] },
                        { hour: '10:00', slots: [{ col: 1, label: 'L. Rocha', color: '#7c3aed' }, { col: 3, label: 'T. Neves', color: '#0d6b7a' }] },
                        { hour: '11:00', slots: [{ col: 0, label: 'F. Dias', color: '#2d8a6b' }, { col: 2, label: 'A. Melo', color: '#e08a00' }, { col: 4, label: 'K. Ramos', color: '#0d6b7a' }] },
                      ].map((row, ri) => (
                        <div key={ri} style={{ display: 'grid', gridTemplateColumns: '38px repeat(5, 1fr)', gap: '4px', marginBottom: '4px' }}>
                          <div style={{ fontSize: '9px', color: '#9ab0b4', paddingTop: '4px', textAlign: 'right', paddingRight: '6px' }}>{row.hour}</div>
                          {[0, 1, 2, 3, 4].map((col) => {
                            const slot = row.slots.find(s => s.col === col);
                            return (
                              <div key={col} style={{
                                height: '26px',
                                borderRadius: '5px',
                                background: slot ? slot.color : 'rgba(13,107,122,0.04)',
                                border: slot ? 'none' : '1px dashed rgba(13,107,122,0.12)',
                                display: 'flex', alignItems: 'center', padding: slot ? '0 6px' : '0',
                                overflow: 'hidden',
                              }}>
                                {slot && <span style={{ fontSize: '9px', color: 'white', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slot.label}</span>}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Right panel: upcoming list */}
                    <div style={{ padding: '12px 12px' }}>
                      <p style={{ margin: '0 0 8px', fontSize: '10px', fontWeight: 700, color: '#0d6b7a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Próximas</p>
                      {[
                        { time: '08:00', name: 'M. Santos', status: 'confirmado', color: '#16a34a' },
                        { time: '08:30', name: 'R. Lima', status: 'confirmado', color: '#16a34a' },
                        { time: '09:00', name: 'C. Ferreira', status: 'confirmado', color: '#16a34a' },
                        { time: '09:30', name: 'P. Alves', status: 'pendente', color: '#e08a00' },
                        { time: '10:00', name: 'L. Rocha', status: 'confirmado', color: '#16a34a' },
                        { time: '10:30', name: 'T. Neves', status: 'pendente', color: '#e08a00' },
                      ].map((appt, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '5px 6px', borderRadius: '7px', marginBottom: '3px',
                          background: i === 0 ? 'rgba(13,107,122,0.07)' : 'transparent',
                        }}>
                          <span style={{ fontSize: '9px', color: '#6b8a8f', minWidth: '30px', fontWeight: 600 }}>{appt.time}</span>
                          <span style={{ fontSize: '10px', color: '#1a2e31', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appt.name}</span>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: appt.color, flexShrink: 0 }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bottom bar */}
                  <div style={{
                    borderTop: '1px solid #e8f0f1',
                    padding: '7px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(13,107,122,0.03)',
                  }}>
                    <div style={{ display: 'flex', gap: '14px' }}>
                      {['Agenda', 'Pacientes', 'Relatórios', 'WhatsApp'].map((item, i) => (
                        <span key={i} style={{ fontSize: '10px', color: i === 0 ? '#0d6b7a' : '#9ab0b4', fontWeight: i === 0 ? 700 : 400, cursor: 'pointer' }}>{item}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                      <span style={{ fontSize: '9px', color: '#6b8a8f' }}>WhatsApp conectado</span>
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div
                className="trust-badges"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {['Confirmações sem ficar a perseguir o paciente', 'Um painel — a equipa sabe o que está marcado', 'Menos buracos na agenda por esquecimento'].map((badge) => (
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
          <section id="problemas" className="section section-bg-alt section-rhythm">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Segunda de manhã: isto ainda acontece na sua clínica?
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Cada item abaixo custa vaga preenchida, tempo da receção e paciência do paciente — no mesmo dia.
              </motion.p>

              <motion.div
                className="grid grid-2"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                {[
                  { title: 'Três pessoas à espera enquanto a receção confirma o mesmo horário', desc: 'O telefone toca, o WhatsApp pisca, e quem está no balcão ouve: “Já tinha combinado com a Dra.” pela terceira vez na semana.' },
                  { title: 'Manhã cheia no papel — três cadeiras vazias à tarde', desc: 'Paciente marcou, sumiu da thread, não atendeu a confirmação. A vaga ficou ali, ocupada no caderno, livre na vida real.' },
                  { title: '“Qual é o horário mesmo?” — ninguém consulta a mesma folha', desc: 'Planilha num portátil, anotação na receção, conversa antiga no WhatsApp. Marcam por cima sem querer e o dia desanda em 10 minutos.' },
                  { title: 'A receção vira central de chamadas em vez de acolher quem chegou', desc: 'Metade da manhã em “só confirmando”, em vez de organizar fila, pagamentos e quem precisa de ajuda na hora.' },
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
          <section id="solucao" className="section section-tight">
            <div className="container">
              <div style={{ maxWidth: '820px', margin: '0 auto' }}>
                <motion.h2
                  className="text-center mb-3"
                  variants={titleVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-100px' }}
                >
                  O que muda no seu dia quando a agenda deixa de ser um quebra-cabeças
                </motion.h2>
                <motion.p
                  className="text-center"
                  style={{ color: 'var(--text-light)', marginBottom: 'var(--spacing-xl)', fontSize: '1.05rem' }}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  viewport={{ once: true, margin: '-100px' }}
                >
                  Menos improviso na receção. Mais vagas que se cumprem. O sistema trabalha a confirmação; a sua equipa trabalha o atendimento.
                </motion.p>
              </div>

              <motion.div
                className="solution-asymmetric mb-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                <motion.div className="solution-main-panel" variants={itemVariants}>
                  <h3 style={{ fontSize: '1.35rem', marginBottom: 'var(--spacing-sm)' }}>
                    Você recupera tempo e previsibilidade — sem exigir mais horas da equipa
                  </h3>
                  <ul className="solution-gain-list">
                    <li><strong>Ganho:</strong> fim da caça à mensagem certa no WhatsApp — tudo desemboca num painel onde a marcação é oficial.</li>
                    <li><strong>Ganho:</strong> pacientes recebem lembretes e confirmam no fluxo — a receção deixa de “correr atrás” do mesmo nome cinco vezes.</li>
                    <li><strong>Ganho:</strong> horários visíveis para quem atende — menos choque de “isso não estava na minha folha”.</li>
                    <li><strong>Ganho:</strong> buracos na agenda viram algo que você vê cedo — não só quando a sala fica vazia.</li>
                  </ul>
                </motion.div>
                <motion.div className="solution-side-panel" variants={itemVariants}>
                  <p style={{ fontSize: '1.05rem', fontStyle: 'italic', color: 'var(--text-light)', margin: 0, lineHeight: 1.65 }}>
                    “O que eu quero na prática é simples: o doente sabe que vem, a equipa sabe que ele vem, e ninguém perde meia hora a reconfirmar o óbvio.”
                  </p>
                  <p style={{ marginTop: 'var(--spacing-md)', fontSize: '0.85rem', color: 'var(--text-lighter)', marginBottom: 0 }}>
                    — objetivo que ouvimos de donos de clínica todos os meses
                  </p>
                </motion.div>
              </motion.div>
            </div>
          </section>

          {/* How It Works */}
          <section id="passos" className="section section-bg-alt section-rhythm">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Quatro passos até você parar de viver no telefone por causa da agenda
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Em cada etapa o ganho é concreto: menos retrabalho na receção, mais comparecimentos e visão única para quem manda na clínica.
              </motion.p>

              <div className="steps">
                {[
                  { step: 1, title: 'Paciente entra — e você deixa de perder o rasto', desc: 'Ganho: primeiro contacto vira registo no sistema, não mais um balão perdido no WhatsApp da receção.' },
                  { step: 2, title: 'Ele escolhe horário sem “esperar abrir o livro”', desc: 'Ganho: vê lugares livres na hora — menos idas e voltas e menos marcações por cima por engano.' },
                  { step: 3, title: 'Confirmações sem insistência manual sua', desc: 'Ganho: lembretes fazem o trabalho repetitivo; a equipa recupera blocos de tempo para quem já está no consultório.' },
                  { step: 4, title: 'Um painel — todos falam da mesma agenda', desc: 'Ganho: dono, receção e profissional olham o mesmo quadro — acaba a versão “a minha vs. a tua”.' },
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
          <section id="beneficios" className="section section-loose">
            <div className="container">
              <motion.h2
                className="text-center mb-3"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Números que donos de clínica repetem após as primeiras semanas
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Metas típicas de operações que ligaram confirmação e agenda num só lugar — o efeito real depende do seu fluxo hoje.
              </motion.p>

              <motion.div
                className="stats-mega mb-4"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                <div className="stats-mega-grid">
                  {[
                    { number: '−60%', label: 'menos faltas após organizar confirmação' },
                    { number: '+5h', label: 'devolvidas à receção por semana' },
                    { number: '+40%', label: 'mais marcações que chegam confirmadas' },
                    { number: '95%', label: 'taxa de confirmação com lembretes no fluxo' },
                  ].map((item) => (
                    <div key={item.number} className="stats-mega-item">
                      <div className="stats-mega-number">{item.number}</div>
                      <p className="stats-mega-label">{item.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </section>

          {/* For Whom */}
          <section className="section section-bg-alt section-tight">
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
          <section id="depoimentos" className="section section-loose">
            <div className="container">
              <motion.h2
                className="text-center mb-4"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Histórias com números — não só opinião
              </motion.h2>
              <motion.p
                className="text-center"
                style={{color: 'var(--text-light)', marginBottom: 'var(--spacing-2xl)', fontSize: '1.05rem'}}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Depoimentos de operações que mediram antes e depois na primeira semana ou no primeiro mês.
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
                    quote: 'Na primeira semana reduzi faltas em cerca de 40% — parei de perseguir confirmação no WhatsApp. Hoje a receção não faz aquelas 15 ligações diárias; o fluxo manda o lembrete e nós só acompanhamos o painel.',
                    initials: 'DR',
                    name: 'Dra. Roberta Silva',
                    role: 'Cardiologista em SP',
                    metrics: '−40% faltas na 1.ª semana | 15 ligações/dia → 0'
                  },
                  {
                    quote: 'Reduzi faltas de 30% para 5% no primeiro mês — as cadeiras deixaram de “apagar” à tarde. Em quatro dias já via menos buracos na agenda; o número fechou o mês seguinte.',
                    initials: 'CV',
                    name: 'Carlos Ventura',
                    role: 'Dentista em MG',
                    metrics: '30% → 5% faltas | +R$ 3.200/mês estimado'
                  },
                  {
                    quote: 'Cortei de 8h para 3h por semana só em confirmação — a secretária aprendeu o painel em 20 minutos. Pacientes respondem no próprio lembrete; deixámos de ligar para perguntar “você vem?”.',
                    initials: 'FO',
                    name: 'Fernanda Oliveira',
                    role: 'Clínica de Estética em RJ',
                    metrics: '8h → 3h/semana em confirmações | NPS interno subiu'
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
                  <colgroup>
                    <col />
                    <col className="col-manual" />
                    <col className="col-ac" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Processo</th>
                      <th scope="col" className="th-manual">Atendimento manual</th>
                      <th scope="col" className="th-ac">Com AgendaClinic</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row"><strong>Confirmação de consulta</strong></th>
                      <td className="td-manual">Recepcionista liga ou envia mensagem (manual)</td>
                      <td className="td-ac">Sistema envia automaticamente <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Taxa de confirmação</strong></th>
                      <td className="td-manual">50–60%</td>
                      <td className="td-ac">95%+ <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Tempo na receção</strong></th>
                      <td className="td-manual">5–8h por semana em confirmações</td>
                      <td className="td-ac">Liberado para outras tarefas <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Agendamento pelo paciente</strong></th>
                      <td className="td-manual">Precisa de atendente disponível <span className="x">✗</span></td>
                      <td className="td-ac">Disponível 24/7 <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Histórico do paciente</strong></th>
                      <td className="td-manual">Espalhado em várias anotações <span className="x">✗</span></td>
                      <td className="td-ac">Centralizado e organizado <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Visão da agenda</strong></th>
                      <td className="td-manual">Múltiplos sistemas e papéis <span className="x">✗</span></td>
                      <td className="td-ac">Um painel claro e simples <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Resposta a dúvidas</strong></th>
                      <td className="td-manual">Demora para atender <span className="x">✗</span></td>
                      <td className="td-ac">Respostas automáticas imediatas <span className="check">✓</span></td>
                    </tr>
                    <tr>
                      <th scope="row"><strong>Relatórios e análise</strong></th>
                      <td className="td-manual">Difícil de mensurar <span className="x">✗</span></td>
                      <td className="td-ac">Relatórios automáticos <span className="check">✓</span></td>
                    </tr>
                  </tbody>
                </table>
              </motion.div>
            </div>
          </section>

          <LandingPricingSection urgencyDeadline={urgencyDeadline} />

          {/* FAQ */}
          <section id="faq" className="section section-tight faq-section" aria-labelledby="faq-heading">
            <div className="container">
              <motion.h2
                id="faq-heading"
                className="text-center mb-3"
                variants={titleVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-100px' }}
              >
                Perguntas frequentes
              </motion.h2>
              <motion.p
                className="text-center"
                style={{ color: 'var(--text-light)', marginBottom: 'var(--spacing-xl)', fontSize: '1.05rem' }}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: '-100px' }}
              >
                Contrato, cancelamento, suporte e dados — direto ao ponto.
              </motion.p>
              <div style={{ maxWidth: '42rem', margin: '0 auto' }}>
                <details data-aos="fade-up" data-aos-delay="100">
                  <summary>Existe fidelidade ou contrato longo?</summary>
                  <p>
                    Não exigimos contrato de longo prazo para os planos em cartão: você assina mensalmente e renova enquanto fizer sentido para a clínica. O Enterprise pode ter acordo com prazos — isso é alinhado com o time comercial quando for o caso.
                  </p>
                </details>
                <details data-aos="fade-up" data-aos-delay="200">
                  <summary>Como funciona o cancelamento?</summary>
                  <p>
                    Você cancela pelo painel ou falando com o suporte antes da próxima cobrança. Durante o teste de 7 dias não há cobrança; depois disso, o que já foi faturado segue o ciclo vigente até o fim do período pago, conforme a política exibida na contratação.
                  </p>
                </details>
                <details data-aos="fade-up" data-aos-delay="300">
                  <summary>Qual o tempo de resposta do suporte?</summary>
                  <p>
                    No plano Básico priorizamos email em horário comercial. No Profissional há canal por WhatsApp combinado com a equipe. No Enterprise há fila prioritária e SLA definido no contrato.
                  </p>
                </details>
                <details data-aos="fade-up" data-aos-delay="400">
                  <summary>O WhatsApp da clínica fica na plataforma?</summary>
                  <p>
                    O envio de lembretes e confirmações usa o fluxo que você configurar (incluindo integrações compatíveis). Você mantém o número da clínica; nós mostramos no onboarding como conectar de forma segura e em linha com as políticas do WhatsApp Business.
                  </p>
                </details>
                <details data-aos="fade-up" data-aos-delay="500">
                  <summary>Meus dados e de pacientes estão protegidos (LGPD)?</summary>
                  <p>
                    Tratamos dados de operação com base em contrato e política de privacidade: acesso restrito à sua equipe, registro de operações necessárias e opções de exportação ou exclusão conforme solicitado e lei aplicável. Detalhes completos estão nos documentos legais do site.
                  </p>
                </details>
              </div>
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
                Teste o AgendaClinic gratuitamente por 7 dias. Veja seus pacientes confirmando sozinhos. Se não gostar, cancelamos — sem perguntas, sem burocracia.
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
                    Quero organizar minha clínica agora
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
              <div className="footer-section" data-aos="fade-up" data-aos-delay="100">
                <h4>AgendaClinic</h4>
                <p style={{fontSize: '0.9rem', color: 'var(--text-light)', margin: 0}}>
                  A plataforma mais inteligente para gerenciar agendamentos de clínicas e consultórios.
                </p>
              </div>

              <div className="footer-section" data-aos="fade-up" data-aos-delay="200">
                <h4>Produto</h4>
                <ul>
                  <li><a href="#solucao">Como funciona</a></li>
                  <li><a href="#passos">Passos</a></li>
                  <li><a href="#beneficios">Benefícios</a></li>
                  <li><a href="#depoimentos">Depoimentos</a></li>
                  <li><a href="#faq">FAQ</a></li>
                </ul>
              </div>

              <div className="footer-section" data-aos="fade-up" data-aos-delay="300">
                <h4>Suporte</h4>
                <ul>
                  <li><a href="https://wa.me/5511999999999">WhatsApp</a></li>
                  <li><a href="mailto:hello@agendaclinic.com">Email</a></li>
                  <li><a href="#">Central de Ajuda</a></li>
                </ul>
              </div>

              <div className="footer-section" data-aos="fade-up" data-aos-delay="400">
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
                © 2026 AgendaClinic. Todos os direitos reservados.
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
