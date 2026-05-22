import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        noir: {
          black:    '#0a0a0a',
          deep:     '#0f0f0f',
          charcoal: '#1a1a1a',
          graphite: '#242424',
          muted:    '#2e2e2e',
          border:   '#3a3a3a',
          dim:      '#555555',
          ash:      '#888888',
          pale:     '#aaaaaa',
          silver:   '#cccccc',
          white:    '#f5f5f0',
        },
        accent: {
          gold:    '#c8a96e',
          crimson: '#8b1a1a',
          amber:   '#d4882a',
          ivory:   '#f0ead6',
          glow:    'rgba(200,169,110,0.15)',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        body:    ['"Crimson Pro"', 'serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
        ui:      ['"Inter"', 'sans-serif'],
      },
      backdropBlur: {
        xs:   '2px',
        noir: '12px',
      },
      animation: {
        'lyric-glow':  'lyricGlow 0.4s ease-out forwards',
        'waveform':    'waveform 1.2s ease-in-out infinite',
        'pulse-slow':  'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':     'fadeIn 0.3s ease-out',
        'slide-up':    'slideUp 0.4s cubic-bezier(0.16,1,0.3,1)',
        'spin-slow':   'spin 3s linear infinite',
        'bounce-soft': 'bounceSoft 1.4s ease-in-out infinite',
      },
      keyframes: {
        lyricGlow: {
          '0%':   { opacity: '0.3', transform: 'scale(0.98)' },
          '100%': { opacity: '1',   transform: 'scale(1)' },
        },
        waveform: {
          '0%, 100%': { height: '4px' },
          '50%':      { height: '20px' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { transform: 'translateY(16px)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
      },
      boxShadow: {
        'noir-lg':   '0 20px 60px rgba(0,0,0,0.8)',
        'noir-glow': '0 0 30px rgba(200,169,110,0.2), 0 0 60px rgba(200,169,110,0.1)',
        'lyric':     '0 0 20px rgba(200,169,110,0.4)',
        'inner-top': 'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
    },
  },
  plugins: [],
};

export default config;
