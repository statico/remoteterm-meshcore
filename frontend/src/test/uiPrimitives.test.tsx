import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';

describe('native ui primitives', () => {
  it('Label is a native label that associates with its control', () => {
    render(
      <>
        <Label htmlFor="name" className="extra">
          Name
        </Label>
        <input id="name" />
      </>
    );
    const label = screen.getByText('Name');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveClass('text-sm', 'extra');
    expect(screen.getByLabelText('Name').tagName).toBe('INPUT');
  });

  it('Separator renders a decorative horizontal rule and merges classes', () => {
    const { container } = render(<Separator className="my-2" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('role')).toBe('none');
    expect(el.getAttribute('data-orientation')).toBe('horizontal');
    expect(el).toHaveClass('bg-border', 'w-full', 'my-2');
  });

  it('Button renders a native button with variant classes', () => {
    render(
      <Button variant="destructive" size="sm">
        Go
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toHaveClass('bg-destructive', 'h-9');
  });
});
