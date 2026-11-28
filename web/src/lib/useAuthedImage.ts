import { useEffect, useState } from 'react';

import { api } from '../api/client';

/**
 * URL local (blob:) de una imagen de la API que exige sesión: un `<img src>` no manda
 * el token, así que se descarga con el cliente y se muestra como blob.
 */
export function useAuthedImage(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // Al cambiar de imagen no se muestra la anterior (su blob ya se liberó).
    setUrl(null);
    if (!path) {
      setUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    api
      .get(path, { responseType: 'blob' })
      .then((r) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(r.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}
