import { render, screen } from '@testing-library/react';
import { FormField } from './form-field';

describe('formfield', () => {
  it('renders its children', () => {
    render(
      <FormField label="Name" htmlFor="Name">
        <input id="name" data-testid="child-input" />
      </FormField>,
    );
  });

  it('renders Error message when none is provided', () => {
    render(
      <FormField label="email" htmlFor="email" error="invalid email">
        <input id="email" />
      </FormField>,
    );
    expect(screen.getByText('invalid email')).toBeInTheDocument();
  });
});
