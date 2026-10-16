import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Wallet } from 'lucide-react';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { toast } from '../../utils/toast';
import { useAuth } from '../../context/AuthContext';
import ProfilePicture from '../../components/ProfilePicture';
import ChangePasswordForm from '../../components/ChangePasswordForm';
import VerificationPanel from '../../components/verification/VerificationPanel';
import { PageHeader, Badge, Field, inputCls, btnPrimary } from '../../components/ui';

// EasyPaisa / JazzCash accounts customers pay into
function WalletAccounts() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/coach/operator/me').then((r) => {
      const a = r.data.operator?.paymentAccounts || {};
      setForm({
        easypaisa: { number: a.easypaisa?.number || '', title: a.easypaisa?.title || '', enabled: !!a.easypaisa?.enabled },
        jazzcash: { number: a.jazzcash?.number || '', title: a.jazzcash?.title || '', enabled: !!a.jazzcash?.enabled }
      });
    }).catch((err) => toast.error(getErrorMessage(err, 'Could not load payment accounts')));
  }, []);

  if (!form) return <div className="card p-5 text-sm text-muted">Loading payment accounts...</div>;

  const set = (w, k, v) => setForm((f) => ({ ...f, [w]: { ...f[w], [k]: v } }));

  async function save() {
    try {
      setSaving(true);
      await api.patch('/coach/operator/me', { paymentAccounts: form });
      toast.success('Payment accounts saved');
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-bold text-fg"><Wallet className="h-4 w-4 text-link" /> My payment accounts</p>
        <p className="text-xs text-muted">Customers send the fare to these numbers and upload the receipt. You approve it from Wallet payments.</p>
      </div>
      {[['easypaisa', 'EasyPaisa'], ['jazzcash', 'JazzCash']].map(([w, label]) => (
        <div key={w} className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-fg">
            <input type="checkbox" checked={form[w].enabled} onChange={(e) => set(w, 'enabled', e.target.checked)} /> Accept {label}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} value={form[w].number} onChange={(e) => set(w, 'number', e.target.value)} inputMode="tel" maxLength={16} placeholder={`${label} number (03001234567)`} />
            <input className={inputCls} value={form[w].title} onChange={(e) => set(w, 'title', e.target.value)} maxLength={60} placeholder="Account title (name)" />
          </div>
        </div>
      ))}
      <button type="button" className={btnPrimary} disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save accounts'}</button>
    </div>
  );
}

export default function OperatorProfile() {
  const { user, setUser } = useAuth();
  const [company, setCompany] = useState({ companyName: user?.operator?.companyName || '', contactPhone: user?.operator?.contactPhone || '' });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const r = await api.patch('/coach/operator/me', company);
      if (r.data.success) { setUser((u) => ({ ...u, operator: r.data.operator })); toast.success('Company profile updated'); } else toast.error(r.data.message);
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader icon={User} title="Profile" subtitle="Your operator account" />
      <div className="card p-5 space-y-4">
        <ProfilePicture />
        <div className="text-xs text-muted space-y-1"><p><b>{user?.name}</b> • {user?.email} • {user?.phone}</p>
          <p>Status: {user?.isVerified ? <Badge tone="green">approved</Badge> : <Badge tone="amber">waiting for approval</Badge>}</p></div>
      </div>
      <VerificationPanel />
      <form onSubmit={save} className="card p-5 grid gap-3 sm:grid-cols-2 items-end">
        <Field label="Company name"><input required minLength={2} maxLength={80} className={inputCls} value={company.companyName} onChange={(e) => setCompany({ ...company, companyName: e.target.value })} /></Field>
        <Field label="Contact phone"><input className={inputCls} maxLength={20} value={company.contactPhone} onChange={(e) => setCompany({ ...company, contactPhone: e.target.value })} /></Field>
        <div><button className={btnPrimary} disabled={saving || !user?.isVerified}>{saving ? 'Saving...' : 'Save company details'}</button></div>
      </form>
      <WalletAccounts />
      <Link to="/operator/payments" className="card flex items-center gap-2 p-4 text-sm font-semibold text-link hover:border-primary"><Wallet className="h-4 w-4" /> Wallet payments to verify (EasyPaisa / JazzCash receipts)</Link>
      <div className="card p-5"><ChangePasswordForm /></div>
    </div>
  );
}