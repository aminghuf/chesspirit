import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { LogoLockup } from './Logo';
import GitHubStar from './GitHubStar';
import { LANGUAGES, normalizeLanguage } from '../lib/languages';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';

/** Language picker for pages a visitor sees before having a profile. Each
 *  language is listed in its own script, so anyone can find theirs. */
export function LanguageSelect({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <label className={`relative inline-flex items-center ${className ?? ''}`}>
      <Globe className="pointer-events-none absolute start-2 h-4 w-4 text-chesscom-500" aria-hidden />
      <span className="sr-only">{t('landing.language')}</span>
      <select
        value={normalizeLanguage(i18n.language)}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="appearance-none rounded-md border border-chesscom-200 bg-white py-1.5 pe-3 ps-8 text-sm text-chesscom-800 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/20 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-100"
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
      </select>
    </label>
  );
}

/** Top bar of the public pages: landing, try-it and shared reviews. */
export default function PublicHeader() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { config } = useAuthConfig();
  const { pathname } = useLocation();
  const logoClass = 'me-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50';
  return (
    <header className="border-b border-chesscom-200 bg-white/80 backdrop-blur dark:border-chesscom-800 dark:bg-chesscom-900/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        {/* Signed out, home is a full page load: on chesspirit.app the reverse
            proxy serves its own home page at "/", which a client-side route
            would never reach. Signed in, "/" is the app's Home. */}
        {user ? (
          <Link to="/" className={logoClass}><LogoLockup size={30} /></Link>
        ) : (
          <a href="/" className={logoClass}><LogoLockup size={30} /></a>
        )}
        {config.public_site && pathname !== '/self-host' && pathname !== '/' && (
          <Link to="/self-host" className="hidden text-sm text-chesscom-600 hover:text-chesscom-900 hover:underline md:inline dark:text-chesscom-300 dark:hover:text-white">{t('landing.selfHostLink')}</Link>
        )}
        <LanguageSelect />
        <GitHubStar variant="inline" className="hidden sm:inline-flex" />
        {user ? (
          <Link to="/" className="btn-primary">{t('landing.openApp')}</Link>
        ) : (
          <>
            <Link to="/login" className="btn-ghost hidden sm:inline-flex">{t('landing.login')}</Link>
            {config.signup_enabled && <Link to="/signup" className="btn-primary">{t('landing.register')}</Link>}
          </>
        )}
      </div>
    </header>
  );
}
