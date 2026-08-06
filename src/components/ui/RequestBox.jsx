// Redesign handoff PR 2 — UI kit (Cergio UI Kit.dc.html, "04 — WHAT THE AI
// TOUCHES"). RequestBox: the free-form capture box + the green "Read as: …"
// echo line. Three surfaces will share it (home capture, booking, broadcast)
// so the parse-and-echo interaction never drifts apart.
//
// THIS PRIMITIVE DOES NO PARSING AND NO NETWORK. `onParse(text)` is a prop —
// PR 5 wires it to the chat-parse edge function (PATCHES.md §5; the
// prototype's regex is demo scaffolding and must not ship). The echo line is
// what makes a parse correctable, so it renders whenever there is echo text —
// either returned by onParse or passed in via `echo`.
//
//   <RequestBox value={text} onChange={setText} onParse={chatParse} />
//
// onParse may return the echo string directly or { echo }. Uncontrolled use
// (no value/onChange) keeps its own state.

import { useState } from 'react';
import { PerkIcon } from './PerkPanel';

export function RequestBox({
  value,
  onChange,
  onParse,
  echo,
  showEcho = true,
  placeholder = 'Describe what you need…',
  rows = 3,
  className = '',
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState('');
  const [parsedEcho, setParsedEcho] = useState(null);
  const [parsing, setParsing] = useState(false);
  const text = controlled ? value : inner;
  const echoText = echo !== undefined && echo !== null ? echo : parsedEcho;

  const handleChange = (e) => {
    if (!controlled) setInner(e.target.value);
    if (onChange) onChange(e.target.value);
  };

  const handleBlur = async () => {
    if (!onParse || !text || !text.trim() || parsing) return;
    setParsing(true);
    try {
      const res = await onParse(text.trim());
      const line = typeof res === 'string' ? res : res && res.echo;
      if (line) setParsedEcho(line);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      <textarea
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-none rounded-[12px] ring-1 ring-inset ring-bdr bg-card px-4 py-3.5 text-body text-black placeholder:text-b3 focus:outline-none focus:ring-g"
      />
      {showEcho && echoText ? (
        <div className="bg-gl rounded-[10px] px-3.5 py-3 flex items-start gap-2 text-gd">
          <span className="mt-px"><PerkIcon size={15} /></span>
          <span className="flex-1 text-meta font-medium leading-snug">Read as: {echoText}</span>
        </div>
      ) : null}
    </div>
  );
}
