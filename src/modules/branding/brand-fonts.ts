// Self-hosted brand fonts. Imported once at app root (src/main.tsx). Each
// import registers @font-face for one allowlisted family; WOFF2 sources are
// lazy, so declaring all 14 costs ~0 until a family is actually rendered.
// Keep this list in sync with BRAND_FONT_ALLOWLIST in branding.ts.
//
// Variable families import the package root (its index.css exposes the full
// variable font); non-variable families import the specific weights we ship.
import '@fontsource-variable/inter';
import '@fontsource-variable/roboto';
import '@fontsource-variable/open-sans';
import '@fontsource-variable/montserrat';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/work-sans';
import '@fontsource-variable/merriweather';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/lora';
import '@fontsource/pt-serif/400.css';
import '@fontsource/pt-serif/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
