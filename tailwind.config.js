// ==========================================
// Tailwind Play-CDN Konfiguration (extern, damit die
// Content Security Policy ohne 'unsafe-inline' für
// Skripte auskommt – kein Inline-<script> mehr nötig).
// Muss NACH https://cdn.tailwindcss.com geladen werden.
// ==========================================
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
            },
            colors: {
                primary: {
                    DEFAULT: 'var(--color-primary, #3b82f6)',
                    hover: 'var(--color-primary-hover, #2563eb)',
                    text: 'var(--color-primary-text, #ffffff)',
                },
                accent: {
                    DEFAULT: 'var(--color-accent, #10b981)',
                    hover: 'var(--color-accent-hover, #059669)',
                }
            }
        }
    }
};
