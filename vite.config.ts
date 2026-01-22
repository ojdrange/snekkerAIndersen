
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Last inn env-filer basert på modus (development/production)
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    define: {
      // Vi mapper både VITE_API_KEY og API_KEY til process.env.API_KEY
      'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY || env.API_KEY || '')
    },
    server: {
      port: 3000
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});
