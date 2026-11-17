// Public API of school certificates: TC, bonafide and fee-paid certificates, from request to a
// numbered, frozen, QR-verifiable document. Owns school_certificate_request; numbers in
// school_number_counter.
export {
  approveCertificate,
  cancelCertificate,
  CERTIFICATE_ISSUED,
  CERTIFICATE_REQUESTED,
  CertificateError,
  certificateDetail,
  checkCertificate,
  editDraft,
  issueCertificate,
  listCertificates,
  recordPortalExport,
  reissueCertificate,
  requestCertificate,
  STUDENT_LEFT,
  type CertificateDeps,
  type CertificateDetail,
  type CertificateSummary,
} from './application/certificates.js';
export { KINDS, type Kind, type Warning } from './domain/certificate.js';
export { idCards } from './application/id-cards.js';
