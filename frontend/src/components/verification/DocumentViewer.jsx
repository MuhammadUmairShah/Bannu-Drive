import { useEffect, useState } from 'react';
import Modal from '../Modal';
import api from '../../utils/api';
import { getErrorMessage } from '../../utils/errors';
import { Loading, ErrorBox } from '../ui';

// Shows a PRIVATE document. The file is fetched through the authenticated API as a blob and shown from an
// in-memory object URL: there is no public or shareable link to the document anywhere.
export default function DocumentViewer({ doc, title, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', url: '', mime: '' });

  useEffect(() => {
    if (!doc) return undefined;
    let objectUrl = '';
    let cancelled = false;
    setState({ loading: true, error: '', url: '', mime: '' });

    api
      .get(`/verification/documents/${doc.id}/file`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setState({ loading: false, error: '', url: objectUrl, mime: res.data.type || doc.mime });
      })
      .catch((err) => !cancelled && setState({ loading: false, error: getErrorMessage(err, 'Could not load the document'), url: '', mime: '' }));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  return (
    <Modal isOpen={!!doc} onClose={onClose} title={title || 'Document'} maxWidth="max-w-3xl">
      <div className="min-h-[200px]">
        {state.loading && <Loading text="Loading document..." />}
        {state.error && <ErrorBox message={state.error} />}
        {state.url && state.mime === 'application/pdf' && (
          <iframe title="Document" src={state.url} className="h-[70vh] w-full rounded-xl border border-line" />
        )}
        {state.url && state.mime !== 'application/pdf' && (
          <img src={state.url} alt={title || 'Document'} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-xl object-contain" />
        )}
        <p className="mt-3 text-center text-[11px] text-subtle">Private document. Do not share or download it unless necessary.</p>
      </div>
    </Modal>
  );
}
