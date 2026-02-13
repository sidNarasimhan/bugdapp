'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Maximize2, Minimize2, XCircle, RefreshCw, ExternalLink } from 'lucide-react';

interface BrowserViewerProps {
  runId: string;
  vncPort?: number;
  websockifyPort?: number;
  streamUrl?: string;
  onClose?: () => void;
  autoConnect?: boolean;
}

type ConnectionState = 'loading' | 'ready' | 'error';

/**
 * Browser viewer component using noVNC for live test execution viewing
 * Embeds the noVNC web interface in an iframe for direct VNC access
 */
export function BrowserViewer({
  runId,
  vncPort,
  websockifyPort = 6080,
  streamUrl,
  onClose,
  autoConnect = true,
}: BrowserViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Construct the noVNC URL
  // noVNC is served by websockify on the executor container
  // Default to localhost:6080 for local development
  const getNoVncUrl = () => {
    if (streamUrl) return streamUrl;

    // In Docker network, executor is accessible via container name
    // For browser access, we use the host port mapping
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const port = websockifyPort;

    // noVNC URL with auto-connect parameters
    // VNC server runs without password for easy live viewing
    const params = new URLSearchParams({
      autoconnect: 'true',
      resize: 'scale',
      reconnect: 'true',
      reconnect_delay: '1000',
      view_only: 'true',  // Prevent user from interacting with test browser
      show_dot: 'false',  // Don't show cursor
    });

    return `http://${host}:${port}/vnc.html?${params.toString()}`;
  };

  const noVncUrl = getNoVncUrl();

  const handleIframeLoad = () => {
    setConnectionState('ready');
    setError(null);
  };

  const handleIframeError = () => {
    setError('Failed to load VNC viewer');
    setConnectionState('error');
  };

  const retry = () => {
    setConnectionState('loading');
    setError(null);
    setRetryCount(prev => prev + 1);
  };

  // Handle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Open in new window for better experience
  const openInNewWindow = () => {
    window.open(noVncUrl, '_blank', 'width=1300,height=800,menubar=no,toolbar=no');
  };

  return (
    <div
      ref={containerRef}
      className="relative bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-white">Live Browser View</span>
          <ConnectionIndicator state={connectionState} />
        </div>
        <div className="flex items-center space-x-2">
          {connectionState === 'error' && (
            <button
              onClick={retry}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
              title="Retry"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={openInNewWindow}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
            title="Open in new window"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
              title="Close viewer"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* noVNC iframe */}
      <div className="relative aspect-video bg-black">
        {connectionState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
            <div className="text-center">
              <Loader2 className="h-8 w-8 text-zinc-400 animate-spin mx-auto mb-2" />
              <p className="text-zinc-400">Connecting to browser...</p>
              <p className="text-zinc-500 text-xs mt-1">Loading VNC viewer</p>
            </div>
          </div>
        )}

        {connectionState === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
            <div className="text-center">
              <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-400 font-medium">{error || 'Connection failed'}</p>
              <p className="text-zinc-400 text-sm mt-1 mb-3">
                Make sure the executor container is running
              </p>
              <div className="flex items-center justify-center space-x-2">
                <button
                  onClick={retry}
                  className="px-4 py-2 bg-white hover:bg-zinc-200 text-black rounded-lg text-sm transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={openInNewWindow}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors"
                >
                  Open Direct Link
                </button>
              </div>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          key={retryCount}
          src={autoConnect ? noVncUrl : undefined}
          className="w-full h-full border-0"
          style={{
            minHeight: isFullscreen ? '100vh' : '500px',
            display: connectionState === 'error' ? 'none' : 'block'
          }}
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 text-xs text-zinc-400 flex items-center justify-between">
        <span>
          Run ID: {runId}
          {vncPort && ` • VNC: ${vncPort}`}
          {websockifyPort && ` • WebSockify: ${websockifyPort}`}
        </span>
        <a
          href={noVncUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-300 hover:text-zinc-200"
        >
          Direct link
        </a>
      </div>
    </div>
  );
}

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const colors = {
    loading: 'bg-yellow-500 animate-pulse',
    ready: 'bg-green-500',
    error: 'bg-red-500',
  };

  const labels = {
    loading: 'Loading...',
    ready: 'Ready',
    error: 'Error',
  };

  return (
    <div className="flex items-center space-x-1.5">
      <div className={`w-2 h-2 rounded-full ${colors[state]}`} />
      <span className="text-xs text-zinc-400">{labels[state]}</span>
    </div>
  );
}

export default BrowserViewer;
