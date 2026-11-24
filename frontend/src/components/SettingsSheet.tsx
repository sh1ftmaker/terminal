// Per-device preferences. Opened from the home header and from the terminal's
// "more" menu, so everything here applies live to whatever is behind it.

import { Minus, Monitor, Moon, Plus, RotateCw, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import Sheet from './ui/Sheet';
import Segmented from './ui/Segmented';
import Switch from './ui/Switch';
import NotificationRow from './NotificationToggle';
import { FONT_MAX, FONT_MIN, setSettings, useSettings, type ThemePref } from '../lib/settings';
import { useThemeKey } from '../lib/theme';
import { store } from '../lib/storage';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Extra section rendered first (session-specific actions). */
  children?: ReactNode;
}

// Shared with Terminal.tsx, which owns the copy behaviour.
const UNWRAP_COPY_KEY = 'terminal.unwrapCopy';
const UNWRAP_COPY_EVENT = 'terminal:unwrap-copy';
function readUnwrap(): boolean {
  return store.get(UNWRAP_COPY_KEY) !== '0';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="eyebrow m-0 mb-1">{title}</h3>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        {hint && <div className="text-[13px] text-ink-2 mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

// Mounted only while the sheet is open, so it re-reads the stored value
// (the select overlay can change it too) every time.
function UnwrapRow() {
  const [unwrap, setUnwrapState] = useState(readUnwrap);
  const setUnwrap = (on: boolean) => {
    store.set(UNWRAP_COPY_KEY, on ? '1' : '0');
    setUnwrapState(on);
    window.dispatchEvent(new Event(UNWRAP_COPY_EVENT));   // open terminals pick it up
  };
  return (
    <Row title="Unwrap copied lines" hint="Re-join lines the terminal wrapped, so long commands and URLs copy as one line">
      <Switch label="Unwrap copied lines" checked={unwrap} onChange={setUnwrap} />
    </Row>
  );
}

export default function SettingsSheet({ open, onClose, children }: SettingsSheetProps) {
  const settings = useSettings();
  const themeKey = useThemeKey();
  const lightApp = themeKey.startsWith('light');
  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      {children}

      <Section title="Appearance">
        <div className="py-3">
          <Segmented<ThemePref>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => setSettings({ theme })}
            options={[
              { value: 'system', label: <><Monitor size={15} /> System</> },
              { value: 'light', label: <><Sun size={15} /> Light</> },
              { value: 'dark', label: <><Moon size={15} /> Dark</> },
            ]}
          />
        </div>
        <Row
          title="Keep terminal dark"
          hint={lightApp ? 'Use the dark palette inside the terminal' : 'Applies when the light theme is active'}
        >
          <Switch label="Keep terminal dark" checked={settings.darkTerminal} onChange={(darkTerminal) => setSettings({ darkTerminal })} />
        </Row>
      </Section>

      <Section title="Terminal">
        <Row title="Text size" hint="Smaller text fits more columns">
          <div className="flex items-center gap-1">
            <button
              className="icon-btn bg-surface-2"
              aria-label="Smaller text"
              disabled={settings.fontSize <= FONT_MIN}
              onClick={() => setSettings({ fontSize: settings.fontSize - 1 })}
            >
              <Minus size={18} />
            </button>
            <span className="w-11 text-center font-mono text-[14px] tabular" aria-live="polite">{settings.fontSize}px</span>
            <button
              className="icon-btn bg-surface-2"
              aria-label="Larger text"
              disabled={settings.fontSize >= FONT_MAX}
              onClick={() => setSettings({ fontSize: settings.fontSize + 1 })}
            >
              <Plus size={18} />
            </button>
          </div>
        </Row>
        <UnwrapRow />
        {canVibrate && (
          <Row title="Key haptics" hint="A short tick when a key-bar key is pressed">
            <Switch label="Key haptics" checked={settings.haptics} onChange={(haptics) => setSettings({ haptics })} />
          </Row>
        )}
      </Section>

      <Section title="Notifications">
        <NotificationRow />
      </Section>

      <Section title="App">
        <Row title="Reload" hint="Fetch the latest version of the app">
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            <RotateCw size={15} /> Reload
          </button>
        </Row>
      </Section>
    </Sheet>
  );
}
