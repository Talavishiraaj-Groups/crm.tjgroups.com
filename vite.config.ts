import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL ?? ''

  // `npm run dev` must not quietly become a live production client.
  //
  // Pointing the dev server at the deployed Apps Script URL does not give you
  // a read-only view of production: every action in the local UI is a real
  // write to the live CRM. Creating a lead creates a production lead; marking
  // a deal Won writes a real commission row.
  //
  // Use `npm run dev:api` with a converted copy of the data instead. If you
  // genuinely need to point at a REMOTE backend (a staging deployment), opt in
  // explicitly with ALLOW_REMOTE_API=1.
  if (command === 'serve') {
    const isRemote = /^https?:\/\//i.test(apiUrl) && !/localhost|127\.0\.0\.1/.test(apiUrl)
    if (isRemote && env.ALLOW_REMOTE_API !== '1') {
      throw new Error(
        '\n[dev] REFUSING TO START: VITE_API_URL points at a remote backend.\n\n' +
        `        ${apiUrl.slice(0, 60)}...\n\n` +
        '        Local development would then read AND WRITE the live CRM.\n' +
        '        Every click here would be a real change to production data.\n\n' +
        '        Run the local backend instead:\n\n' +
        '          npm run dev:api -- --data local/.data/crm-export.json\n' +
        '          node -e "require(\'fs\').writeFileSync(\'.env.local\',\'VITE_API_URL=http://localhost:8787\\n\')"\n' +
        '          npm run dev\n\n' +
        '        If this really is an isolated STAGING deployment, opt in:\n\n' +
        '          set ALLOW_REMOTE_API=1 && npm run dev        (Windows cmd)\n' +
        '          $env:ALLOW_REMOTE_API=1; npm run dev         (PowerShell)\n'
      )
    }
    if (isRemote) {
      console.warn(
        `\n[dev] ALLOW_REMOTE_API=1 — this dev server is talking to a REMOTE backend.\n` +
        `      Every write goes to ${apiUrl.slice(0, 48)}...\n`
      )
    }
  }

  // Vite inlines import.meta.env.VITE_* at BUILD time — the value is baked
  // into the JS bundle, not read when the page loads. Two consequences worth
  // guarding, because both are silent failures in production:
  if (command === 'build') {
    if (!apiUrl) {
      console.warn(
        '\n[build] VITE_API_URL is not set.\n' +
        '        The bundle will ship with no backend URL and every request\n' +
        '        will fail with NOT_CONFIGURED. On Vercel, set it under\n' +
        '        Project Settings -> Environment Variables, then redeploy.\n'
      )
    } else if (/localhost|127\.0\.0\.1/.test(apiUrl)) {
      // A local .env.local would otherwise be compiled into a deployable build.
      throw new Error(
        `\n[build] REFUSING TO BUILD: VITE_API_URL points at "${apiUrl}".\n` +
        '        That is the local dev API. Building now would bake localhost\n' +
        '        into the bundle, and the deployed site would try to reach the\n' +
        '        visitor\'s own machine.\n\n' +
        '        For a local check this is fine — use `npm run dev` instead.\n' +
        '        To produce a deployable build, unset VITE_API_URL locally and\n' +
        '        let the hosting platform supply the real value.\n'
      )
    }
  }

  return {
    plugins: [react()],
  }
})
