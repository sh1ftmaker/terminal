import { lazy, Suspense, useState, useEffect } from 'react';
import SessionList from './components/SessionList';
import TerminalView from './components/TerminalView';
import ToastHost from './components/ui/ToastHost';
import { appPath, currentRoute } from './lib/base';

// The canvas (and its voice agent) is a different, desktop-leaning home: keep
// it out of the bundle a phone downloads to reach its sessions.
const CanvasView = lazy(() => import('./components/canvas/CanvasView'));

interface Selection {
  session: string;
  context?: string;
}

type HomeView = 'list' | 'canvas';

const HOME_VIEW_KEY = 'terminal:homeView';

function savedHomeView(): HomeView {
  try {
    return localStorage.getItem(HOME_VIEW_KEY) === 'canvas' ? 'canvas' : 'list';
  } catch {
    return 'list';
  }
}

interface Route {
  selection: Selection | null;
  home: HomeView;
}

function readUrl(): Route {
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session');
  if (session) {
    return {
      selection: { session, context: params.get('context') || undefined },
      home: savedHomeView(),
    };
  }
  // /canvas is an explicit deep link; plain / uses the per-device preference.
  const home = currentRoute() === 'canvas' ? 'canvas' : savedHomeView();
  return { selection: null, home };
}

function writeUrl(sel: Selection | null, home: HomeView) {
  if (!sel) {
    window.history.pushState({}, '', appPath(home === 'canvas' ? 'canvas' : ''));
    return;
  }
  const qs = new URLSearchParams();
  qs.set('session', sel.session);
  if (sel.context) qs.set('context', sel.context);
  window.history.pushState({}, '', `?${qs.toString()}`);
}

function App() {
  const [route, setRoute] = useState<Route>(() => readUrl());

  const handleSelectSession = (session: string, context?: string) => {
    const sel: Selection = { session, context };
    setRoute((r) => ({ ...r, selection: sel }));
    writeUrl(sel, route.home);
  };

  const handleBack = () => {
    setRoute((r) => ({ ...r, selection: null }));
    writeUrl(null, route.home);
  };

  const handleSwitchView = (home: HomeView) => {
    try { localStorage.setItem(HOME_VIEW_KEY, home); } catch { /* private mode */ }
    setRoute({ selection: null, home });
    writeUrl(null, home);
  };

  useEffect(() => {
    const handlePopState = () => setRoute(readUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  let view;
  if (route.selection) {
    view = (
      <TerminalView
        key={`${route.selection.context ?? ''}:${route.selection.session}`}
        sessionName={route.selection.session}
        context={route.selection.context}
        onBack={handleBack}
      />
    );
  } else if (route.home === 'canvas') {
    view = (
      <Suspense fallback={<div className="screen" />}>
        <CanvasView
          onSelectSession={handleSelectSession}
          onSwitchView={handleSwitchView}
        />
      </Suspense>
    );
  } else {
    view = (
      <SessionList
        onSelectSession={handleSelectSession}
        onSwitchView={handleSwitchView}
      />
    );
  }

  return (
    <>
      {view}
      <ToastHost />
    </>
  );
}

export default App;
