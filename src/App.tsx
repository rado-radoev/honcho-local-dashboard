import { ConnectionProvider, useConnection } from './state/connection'
import { useHashRoute } from './lib/routing'
import { ConnectScreen } from './components/ConnectScreen'
import { Sidebar } from './components/Sidebar'
import { GetStartedPage } from './pages/GetStartedPage'
import { MemoryMapPage } from './pages/MemoryMapPage'
import { ConclusionsPage } from './pages/ConclusionsPage'
import { ExplorePage } from './pages/ExplorePage'
import { WorkspacePage } from './pages/WorkspacePage'
import { PeersPage } from './pages/PeersPage'
import { PeerPage } from './pages/PeerPage'
import { SessionsPage } from './pages/SessionsPage'
import { SessionPage } from './pages/SessionPage'
import { StatusPage } from './pages/StatusPage'
import { CloudOnlyPage } from './pages/CloudOnlyPage'
import { PerformancePage } from './pages/PerformancePage'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { WebhooksPage } from './pages/WebhooksPage'
import { SettingsPage } from './pages/SettingsPage'
import { ErrorBox } from './components/ui'
import type { Route } from './lib/routing'

function RoutedPage({ route }: { route: Route }) {
  switch (route.name) {
    case 'get-started':
      return <GetStartedPage />
    case 'explore':
      return <ExplorePage />
    case 'memory-map':
      return <MemoryMapPage workspaceId={route.workspaceId} />
    case 'conclusions':
      return <ConclusionsPage workspaceId={route.workspaceId} initialFilters={route.filters} />
    case 'status':
      return <StatusPage />
    case 'cloud-only':
      return <CloudOnlyPage page={route.page} />
    case 'performance':
      return <PerformancePage />
    case 'playground':
      return <PlaygroundPage />
    case 'api-keys':
      return <ApiKeysPage />
    case 'webhooks':
      return <WebhooksPage />
    case 'settings':
      return <SettingsPage />
    case 'workspace':
      return <WorkspacePage workspaceId={route.workspaceId} />
    case 'peers':
      return <PeersPage workspaceId={route.workspaceId} />
    case 'peer':
      return <PeerPage workspaceId={route.workspaceId} peerId={route.peerId} tab={route.tab} />
    case 'sessions':
      return <SessionsPage workspaceId={route.workspaceId} />
    case 'session':
      return (
        <SessionPage workspaceId={route.workspaceId} sessionId={route.sessionId} tab={route.tab} />
      )
  }
}

function Shell() {
  const { api, mode, baseUrl, health, healthError, disconnect } = useConnection()
  const route = useHashRoute()

  if (!api) return <ConnectScreen />

  return (
    <div className="flex min-h-screen bg-ink">
      <Sidebar route={route} health={health} mode={mode} baseUrl={baseUrl} onDisconnect={disconnect} />
      <main className="min-w-0 flex-1 px-8 py-7">
        {health === 'failed' && healthError ? (
          <div className="mb-6">
            <ErrorBox
              message={`Not connected to the Honcho server: ${healthError} Use DISCONNECT in the sidebar to change the server.`}
            />
          </div>
        ) : null}
        <RoutedPage route={route} />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ConnectionProvider>
      <Shell />
    </ConnectionProvider>
  )
}
