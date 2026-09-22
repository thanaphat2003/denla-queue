/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1F3864',
          light: '#2F5386',
          dark: '#14243F',
        },
        accent: {
          DEFAULT: '#C9972E',
          light: '#E0B85C',
        },
        surface: '#FFFFFF',
        canvas: '#F5F6F8',
        ink: {
          DEFAULT: '#1A1F2B',
          muted: '#5B6472',
        },
        success: '#2E7D4F',
        warning: '#D97706',
        danger: '#B3261E',
      },
      fontFamily: {
        display: ['"Prompt"', 'sans-serif'],
        body: ['"Sarabun"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
