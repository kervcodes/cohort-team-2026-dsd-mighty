import { render, screen } from '@testing-library/react';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('renders statcard', () => {
    render(<StatCard label="Due this week" value="34.23" hint="14 invoices" />);
    expect(screen.getByText('Due this week')).toBeInTheDocument();
    expect(screen.getByText('34.23')).toBeInTheDocument();
    expect(screen.getByText('14 invoices')).toBeInTheDocument();
  });
});
