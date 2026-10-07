// Stockfish on the device: the WebAssembly build of Stockfish (the
// single-threaded "lite" one, which needs no cross-origin isolation) in a Web
// Worker, spoken to in UCI. The two files sit next to the offline app, in
// engine/ — mobile/build-apk.sh puts them there.
//
// One search at a time. Asking for another stops the one running and waits
// for its `bestmove` before starting, so answers never cross; a search that
// was superseded before it began resolves as `cancelled`.

import { Chess } from 'chess.js';

export interface EngineLine {
  multipv: number;
  depth: number;
  /** Centipawns for the side to move; null when it is a mate score. */
  cp: number | null;
  /** Mate in N for the side to move (negative: getting mated). */
  mate: number | null;
  pv: string[];
}

export interface SearchResult {
  best: string | null;
  lines: EngineLine[];
  cancelled: boolean;
}

interface Job {
  lines: Map<number, EngineLine>;
  onInfo?: (lines: EngineLine[]) => void;
  resolve: (r: SearchResult) => void;
}

const sorted = (m: Map<number, EngineLine>) => [...m.values()].sort((a, b) => a.multipv - b.multipv);

export function parseInfo(line: string): EngineLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const num = (key: string) => {
    const m = new RegExp(` ${key} (-?\\d+)`).exec(line);
    return m ? Number(m[1]) : null;
  };
  const depth = num('depth');
  if (depth === null) return null;
  return {
    multipv: num('multipv') ?? 1,
    depth,
    cp: num('score cp'),
    mate: num('score mate'),
    pv: line.slice(line.indexOf(' pv ') + 4).trim().split(/\s+/),
  };
}

class OfflineEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private job: Job | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  private post(cmd: string) { this.worker?.postMessage(cmd); }

  private boot(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('engine/stockfish.js', document.baseURI));
      } catch (err) { reject(err); return; }
      this.worker = worker;
      const timer = window.setTimeout(() => reject(new Error('engine_timeout')), 30_000);
      worker.onerror = (e) => { window.clearTimeout(timer); reject(new Error(e.message || 'engine_error')); };
      worker.onmessage = (e) => {
        const line = String(e.data);
        if (line === 'uciok') this.post('isready');
        else if (line === 'readyok') { window.clearTimeout(timer); resolve(); }
        else this.onLine(line);
      };
      this.post('uci');
    });
    // A failed start may be retried (the next call boots again).
    this.ready.catch(() => { this.ready = null; this.worker?.terminate(); this.worker = null; });
    return this.ready;
  }

  private onLine(line: string) {
    const job = this.job;
    if (!job) return;
    if (line.startsWith('bestmove')) {
      this.job = null;
      const best = line.split(' ')[1];
      job.resolve({ best: best && best !== '(none)' ? best : null, lines: sorted(job.lines), cancelled: false });
      return;
    }
    const info = parseInfo(line);
    if (!info) return;
    job.lines.set(info.multipv, info);
    job.onInfo?.(sorted(job.lines));
  }

  private search(setup: string[], go: string, onInfo?: (lines: EngineLine[]) => void): Promise<SearchResult> {
    const mine = ++this.generation;
    if (this.job) this.post('stop');
    const start = async (): Promise<SearchResult> => {
      if (mine !== this.generation) return { best: null, lines: [], cancelled: true };
      await this.boot();
      return new Promise<SearchResult>((resolve) => {
        this.job = { lines: new Map(), onInfo, resolve };
        for (const cmd of setup) this.post(cmd);
        this.post(go);
      });
    };
    const next = this.queue.then(start, start);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Full-strength analysis to `depth`, with `multipv` lines; `onInfo` gets
   *  the lines as they deepen. */
  analyse(fen: string, opts: { depth: number; multipv: number }, onInfo?: (lines: EngineLine[]) => void): Promise<SearchResult> {
    return this.search([
      'setoption name UCI_LimitStrength value false',
      'setoption name Skill Level value 20',
      `setoption name MultiPV value ${opts.multipv}`,
      `position fen ${fen}`,
    ], `go depth ${opts.depth}`, onInfo);
  }

  /** A move to play at a given strength (see LEVELS). */
  move(fen: string, level: Level): Promise<SearchResult> {
    return this.search([
      'setoption name UCI_LimitStrength value false',
      `setoption name Skill Level value ${level.skill}`,
      'setoption name MultiPV value 1',
      `position fen ${fen}`,
    ], `go depth ${level.depth} movetime ${level.ms}`);
  }

  /** Stop whatever is running; its promise still resolves. */
  stop() {
    this.generation++;
    if (this.job) this.post('stop');
  }
}

export interface Level { skill: number; depth: number; ms: number }

// Eight steps from "hangs pieces" to full strength. Skill Level makes the
// engine pick weaker moves on purpose; the depth cap keeps the low levels
// from seeing far, and the time cap keeps a phone responsive.
export const LEVELS: readonly Level[] = [
  { skill: 0, depth: 1, ms: 100 },
  { skill: 2, depth: 2, ms: 150 },
  { skill: 5, depth: 4, ms: 200 },
  { skill: 8, depth: 6, ms: 300 },
  { skill: 11, depth: 8, ms: 500 },
  { skill: 14, depth: 11, ms: 800 },
  { skill: 17, depth: 14, ms: 1200 },
  { skill: 20, depth: 22, ms: 2500 },
];

export const engine = new OfflineEngine();

/** UCI moves → SAN, from `fen`, up to `max` moves (stops at the first one
 *  that doesn't fit the position). */
export function pvToSan(fen: string, pv: string[], max = 8): string[] {
  const out: string[] = [];
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return out; }
  for (const uci of pv.slice(0, max)) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }).san);
    } catch { break; }
  }
  return out;
}

/** A line's score as text, from White's point of view: "+0.4", "−1.2", "#3". */
export function scoreText(line: Pick<EngineLine, 'cp' | 'mate'>, whiteToMove: boolean): string {
  const sign = whiteToMove ? 1 : -1;
  if (line.mate !== null) return `${line.mate * sign < 0 ? '−' : ''}#${Math.abs(line.mate)}`;
  const cp = (line.cp ?? 0) * sign;
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(1)}`;
}

/** Centipawns from White's point of view, mates pinned to ±10000 (EvalBar). */
export function whiteCp(line: Pick<EngineLine, 'cp' | 'mate'> | undefined, whiteToMove: boolean): number {
  if (!line) return 0;
  const own = line.mate !== null ? (line.mate > 0 ? 10000 : -10000) : (line.cp ?? 0);
  return whiteToMove ? own : -own;
}
