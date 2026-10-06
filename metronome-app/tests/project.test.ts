import { describe, expect, it } from 'vitest';
import { audibleParts, parseProject, serializeProject } from '../src/lib/model/project';

describe('projects', () => {
  it('treats a plain map as a one-part project, unchanged', () => {
    const text = '# Song\nA: c=120 4/4 x4\nB: 3/4 x2';
    const { project, errors } = parseProject(text);
    expect(errors).toEqual([]);
    expect(project.title).toBe('Song');
    expect(project.parts).toHaveLength(1);
    expect(serializeProject(project)).toBe(text);
  });

  it('parses parts with sounds and round-trips them', () => {
    const text = '# Song\n== Conductor\nA: c=120 4/4 x4\n== Percussion [bell, 70%, -5]\nA: c=120 2+2+3/8 x4';
    const { project, errors } = parseProject(text);
    expect(errors).toEqual([]);
    expect(project.parts.map((p) => p.name)).toEqual(['Conductor', 'Percussion']);
    expect(project.parts[1].sound).toEqual({ timbre: 'bell', volume: 0.7, transpose: -5 });
    expect(project.parts[1].piece.items).toHaveLength(1);
    expect(serializeProject(project)).toBe(text);
  });

  it('reports errors at their line in the whole text', () => {
    const { errors } = parseProject('# T\n== A\n4/4\n== B\n4/4\nnonsense!');
    expect(errors.map((e) => e.line)).toEqual([6]);
  });

  it('keeps content before the first header as a part, and makes names unique', () => {
    const { project } = parseProject('c=90 4/4\n== Main\n3/4\n==\n2/4');
    expect(project.parts.map((p) => p.name)).toEqual(['Main', 'Main (2)', 'Part 3']);
  });

  it('works out who is heard from mute and solo', () => {
    const names = ['A', 'B', 'C'];
    expect([...audibleParts(names, ['B'], [])]).toEqual(['A', 'C']);
    expect([...audibleParts(names, ['B'], ['B', 'C'])]).toEqual(['B', 'C']);
  });
});
