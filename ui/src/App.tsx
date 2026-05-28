import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { BrowserPage } from './pages/BrowserPage';
import { EditorPage } from './pages/EditorPage';
import { SettingsPage } from './pages/SettingsPage';

function Nav() {
  const { pathname } = useLocation();
  function linkClass(path: string) {
    return `text-sm px-3 py-1 rounded ${pathname === path ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`;
  }
  return (
    <header className="flex items-center gap-3 px-4 h-14 bg-gray-900 border-b border-gray-800 flex-shrink-0">
      <span className="text-white font-semibold text-sm mr-2">🔭 Annotator</span>
      <Link to="/" className={linkClass('/')}>Browse</Link>
      <Link to="/settings" className={linkClass('/settings')}>⚙ Settings</Link>
    </header>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="flex flex-col h-screen">
        <Nav />
        <main className="flex-1 min-h-0 overflow-hidden">
          <Routes>
            <Route path="/" element={<BrowserPage />} />
            <Route path="/annotate" element={<EditorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
