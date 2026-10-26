import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accountStatuses } from '@/app/lib/invoice-form-schema';
import { InvoiceForm } from './invoice-form';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

describe('InvoiceForm', () => {
  beforeEach(() => {
    push.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders every field by its label', () => {
    render(<InvoiceForm />);

    [
      'Account / Customer #',
      'Statement / Bill ID',
      'Customer / Business Name',
      'Property Address',
      'Issue / Record / Invoice Date',
      'Due / Pay Date',
      'Bill Description / Explanation',
      'Prev Payments',
      'Current Due',
      'Account Status',
      'Payment / Processing Notes (optional)',
      'Website Name (optional)',
    ].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
  });

  it('offers an option for every account status', () => {
    render(<InvoiceForm />);

    accountStatuses.forEach((status) => {
      expect(screen.getByRole('option', { name: status })).toBeInTheDocument();
    });
  });

  it('shows validation errors and does not navigate when submitted empty', async () => {
    const user = userEvent.setup();
    const { container } = render(<InvoiceForm />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(
        container.querySelectorAll('[aria-invalid="true"]').length,
      ).toBeGreaterThan(0);
    });
    expect(push).not.toHaveBeenCalled();
  });
});
