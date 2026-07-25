import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { AgentPreview, canShowAgentPreview } from "../../components/AgentPreview.tsx";
import { useArchiveWorkflow } from "../../components/ArchiveRecovery.tsx";
import { useAgents } from "../../data/context.tsx";
import { useParams } from "@tanstack/react-router";

/**
 * /web/agents — every agent this runtime knows about, addressable so the agent
 * management surface can be linked, embedded or popped out instead of existing
 * only as an overlay you have to click your way into.
 */
export function AgentsLeaf() {
  const agents = useAgents();
  return (
    <div className="min-h-0 overflow-auto p-[var(--space-16)]">
      <h1 className="mb-[var(--space-16)] font-display text-[length:var(--text-22)] tracking-[var(--tracking-xs)]">AGENTS</h1>
      {agents.length === 0 ? (
        <p className="font-ui text-ink-soft">No agents registered yet.</p>
      ) : (
        <div className="flex flex-wrap gap-[var(--space-12)]">
          {agents.map((agent) => (
            <Link key={agent.id} to="/agents/$peerId" params={{ peerId: agent.id }} className="min-w-0">
              <AgentPreview agent={agent} density="compact" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** /web/agents/:peerId — one agent, addressed by the same peer_id a DM uses. */
export function AgentLeaf() {
  const agent = useAddressedAgent();
  if (!agent) return <AgentGone />;
  return (
    <div className="min-h-0 overflow-auto p-[var(--space-16)]">
      <AgentPreview agent={agent} />
      {canShowAgentPreview(agent) ? null : (
        <p className="mt-[var(--space-12)] font-ui text-ink-soft">This agent has not reported runtime details yet.</p>
      )}
      <p className="mt-[var(--space-16)] font-ui">
        <Link to="/agents/$peerId/archive" params={{ peerId: agent.id }}>
          Archive and resume
        </Link>
      </p>
    </div>
  );
}

/**
 * /web/agents/:peerId/archive — the archive/resume console, reached by address
 * rather than by clicking. The console itself is the existing modal: this route
 * opens it, so the preview-confirm flows are the same code they always were.
 */
export function AgentArchiveLeaf() {
  const agent = useAddressedAgent();
  const { openConsole } = useArchiveWorkflow();
  useEffect(() => {
    // Once on arrival: re-running would reopen a console the user just dismissed.
    openConsole();
  }, []);
  if (!agent) return <AgentGone />;
  return (
    <div className="min-h-0 overflow-auto p-[var(--space-16)]">
      <AgentPreview agent={agent} />
    </div>
  );
}

function useAddressedAgent() {
  const { peerId } = useParams({ strict: false }) as { peerId?: string };
  return useAgents().find((agent) => agent.id === peerId);
}

function AgentGone() {
  // Not a router not-found: the agent list is live, so an agent that archives
  // while its page is open should not replace the surface with an error page.
  return (
    <div className="min-h-0 grid place-items-center p-[var(--space-16)]">
      <p className="font-ui text-ink-soft">This agent is no longer registered.</p>
    </div>
  );
}
