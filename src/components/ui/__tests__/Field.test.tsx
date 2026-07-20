// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field, FormSummary, Input, focusFirstInvalid } from '../Field';

describe('shared form primitives', () => {
  it('connects the visible label, help, and field error to its control', () => {
    render(<Field label="Service name" help="Shown to customers." error="Enter a service name." required>{(props) => <Input {...props} />}</Field>);
    const input = screen.getByLabelText('Service name *');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Shown to customers. Enter a service name.');
  });

  it('provides an alert summary and can focus the first invalid field after submit', () => {
    render(<><Input id="service-name" /><FormSummary issues={[{ id: 'service-name', message: 'Enter a service name.' }]} /></>);
    focusFirstInvalid([{ id: 'service-name', message: 'Enter a service name.' }]);
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted fields.');
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
});
