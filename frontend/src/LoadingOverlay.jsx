import React from 'react';
import './loading-overlay.css';

export default function LoadingOverlay({visible,label='Salvando alterações…'}){
 if(!visible)return null;
 return <div className="loading-overlay" role="status" aria-live="polite">
  <div className="loading-card"><span className="loading-mark" aria-hidden="true"><i/><i/><i/></span><strong>{label}</strong></div>
 </div>;
}
