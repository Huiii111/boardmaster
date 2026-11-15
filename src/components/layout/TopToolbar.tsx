'use client';

import { useState } from 'react';
import {
  Activity,
  Bot,
  CircuitBoard,
  Code2,
  Cpu,
  GitCompare,
  Layers,
  Redo2,
  Save,
  Undo2,
  Zap,
} from 'lucide-react';

import { EXPERIMENTS } from '@/lib/circuit/experiments';
import { Badge, Button, Input, Select, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';

export function TopToolbar() {
  const projectName = useLabStore((s) => s.projectName);
  const setProjectName = useLabStore((s) => s.setProjectName);
  const experimentId = useLabStore((s) => s.experimentId);
  const setExperiment = useLabStore((s) => s.setExperiment);
  const workspace = useLabStore((s) => s.workspace);
  const setWorkspace = useLabStore((s) => s.setWorkspace);
  const runSimulation = useLabStore((s) => s.runSimulation);
  const simulating = useLabStore((s) => s.simulating);
  const saveVersion = useLabStore((s) => s.saveVersion);
  const undo = useLabStore((s) => s.undo);
  const redo = useLabStore((s) => s.redo);
  const canUndo = useLabStore((s) => s.past.length > 0);
  const canRedo = useLabStore((s) => s.future.length > 0);
  const askTutor = useLabStore((s) => s.askTutor);
  const tutorBusy = useLabStore((s) => s.tutorBusy);
  const server = useLabStore((s) => s.server);
  const report = useLabStore((s) => s.report);

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(projectName);

  const tutorLabel = server.loading
    ? 'Checking tutor…'
    : (server.tutor?.label ?? 'Local Demo Tutor');
  const tutorTone = server.tutor?.mode === 'claude' ? 'accent' : 'warn';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--border-default)] bg-gradient-to-b from-[var(--surface-panel)] to-[var(--surface-raised)] px-3 xl:gap-3">
      {/* brand */}
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-[var(--accent-electric)] to-[var(--accent-cyan)] shadow-[0_0_18px_-4px_rgba(11,122,109,0.6)]">
          <CircuitBoard size={17} className="text-[#04221f]" aria-hidden />
        </div>
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">
            Board<span className="text-[var(--accent-cyan)]">Master</span>
          </div>
          <div className="mt-0.5 hidden text-[9px] uppercase tracking-[0.12em] text-[var(--text-disabled)] xl:block">
            Virtual Electronics Lab
          </div>
        </div>
      </div>

      <div className="h-7 w-px bg-[var(--border-default)]" />

      {/* project name */}
      <div className="hidden w-[132px] shrink-0 lg:block 2xl:w-[180px]">
        {editingName ? (
          <Input
            autoFocus
            value={draftName}
            aria-label="Project name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
              setProjectName(draftName.trim() || 'Untitled LED Lab');
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraftName(projectName);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftName(projectName);
              setEditingName(true);
            }}
            className="group w-full truncate rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
            title="Click to rename the project"
          >
            {projectName}
            <span className="ml-1.5 text-[9px] text-[var(--text-disabled)] opacity-0 transition-opacity group-hover:opacity-100">
              edit
            </span>
          </button>
        )}
      </div>

      {/* experiment selector */}
      <div className="w-[190px] shrink-0 2xl:w-[260px]">
        <Select
          value={experimentId}
          aria-label="Experiment"
          onChange={(e) => setExperiment(e.target.value)}
        >
          {EXPERIMENTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="h-7 w-px bg-[var(--border-default)]" />

      {/* undo / redo / save */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 size={14} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <Redo2 size={14} aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => saveVersion()} title="Save a version (Ctrl+S)">
          <Save size={13} aria-hidden />
          <span className="hidden 2xl:inline">Save</span>
        </Button>
      </div>

      <div className="flex-1" />

      {/* workspace switcher */}
      <nav
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5"
        aria-label="Workspace"
      >
        {(
          [
            { id: 'circuit' as const, label: 'Bench', title: '3D workbench — build the circuit', icon: <Layers size={13} aria-hidden /> },
            { id: 'code' as const, label: 'Code', title: 'Write the Arduino / ESP32 sketch', icon: <Code2 size={13} aria-hidden /> },
            { id: 'pcb' as const, label: 'PCB', title: 'PCB layout and educational checks', icon: <Cpu size={13} aria-hidden /> },
            { id: 'compare' as const, label: 'Compare', title: 'Compare two saved versions', icon: <GitCompare size={13} aria-hidden /> },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setWorkspace(tab.id)}
            aria-current={workspace === tab.id ? 'page' : undefined}
            title={tab.title}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150',
              workspace === tab.id
                ? 'bg-[var(--surface-active)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]',
            )}
          >
            {tab.icon}
            <span className="hidden md:inline">{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="h-7 w-px bg-[var(--border-default)]" />

      {/* tutor mode indicator */}
      <Badge
        tone={tutorTone}
        title={[tutorLabel, ...server.warnings].join(' — ')}
        className="hidden max-w-[164px] lg:inline-flex"
      >
        <Bot size={10} className="shrink-0" aria-hidden />
        <span className="truncate">{tutorLabel}</span>
      </Badge>

      {/* primary actions */}
      <Button
        variant="accent"
        size="md"
        onClick={runSimulation}
        loading={simulating}
        title="Run the deterministic circuit analysis (Ctrl+Enter)"
      >
        {!simulating ? <Zap size={13} aria-hidden /> : null}
        <span>
          Run<span className="hidden 2xl:inline"> Simulation</span>
        </span>
      </Button>
      <Button
        variant="primary"
        size="md"
        onClick={() =>
          askTutor(
            report
              ? 'Please review my circuit and the analysis results.'
              : 'I have not run the simulation yet. What should I do first?',
          )
        }
        loading={tutorBusy}
        title="Ask the AI tutor to review the current evidence"
      >
        {!tutorBusy ? <Activity size={13} aria-hidden /> : null}
        <span>
          AI<span className="hidden xl:inline"> Review</span>
        </span>
      </Button>
    </header>
  );
}
