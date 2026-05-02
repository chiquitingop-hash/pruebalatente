/**
 * @module modules/compras/hooks/useCompras
 * @description Hooks React Query dedicados al módulo COMPRAS unificado.
 *
 * Centralizan todas las llamadas al backend para que los componentes
 * no conozcan endpoints ni armen llaves a mano. Si mañana cambia la
 * ruta base, se cambia en un solo lugar.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/config/api';

const LIST_KEY = 'compras';
const ITEM_KEY = 'compras:item';

// ─── Queries ─────────────────────────────────────────────────────────────────

export const useComprasList = (params = {}) =>
  useQuery({
    queryKey: [LIST_KEY, params],
    queryFn: async () => {
      const { data } = await api.get('/compras', { params });
      return data;
    },
    keepPreviousData: true,
  });

export const useCompra = (id) =>
  useQuery({
    queryKey: [ITEM_KEY, id],
    queryFn: async () => {
      const { data } = await api.get(`/compras/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
  });

// ─── Mutations helper ────────────────────────────────────────────────────────

const useComprasMutation = (fn, { successMsg, onSuccessExtra } = {}) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: [LIST_KEY] });
      if (variables?.id) {
        qc.invalidateQueries({ queryKey: [ITEM_KEY, variables.id] });
      }
      if (successMsg) toast.success(successMsg);
      if (onSuccessExtra) onSuccessExtra(data, variables);
    },
    onError: (err) => {
      const details = err.response?.data?.error?.details;
      if (details?.length) {
        details.forEach((d) => toast.error(`${d.field}: ${d.message}`));
      }
      // toast global via interceptor axios
    },
  });
};

// ─── Mutations específicas ───────────────────────────────────────────────────

export const useCreateCompra = () =>
  useComprasMutation(
    async (payload) => {
      const { data } = await api.post('/compras', payload);
      return data.data;
    },
    { successMsg: 'Proceso de compra creado' }
  );

export const useUpdateCompra = () =>
  useComprasMutation(
    async ({ id, ...payload }) => {
      const { data } = await api.patch(`/compras/${id}`, payload);
      return data.data;
    },
    { successMsg: 'Proceso actualizado' }
  );

export const useIssueOrder = () =>
  useComprasMutation(
    async ({ id }) => {
      const { data } = await api.post(`/compras/${id}/emitir-orden`);
      return data.data;
    },
    { successMsg: 'Orden de compra emitida' }
  );

export const useRegisterInvoice = () =>
  useComprasMutation(
    async ({ id, ...payload }) => {
      const { data } = await api.post(`/compras/${id}/factura`, payload);
      return data.data;
    },
    { successMsg: 'Factura comercial registrada' }
  );

export const useRegisterShipment = () =>
  useComprasMutation(
    async ({ id, ...payload }) => {
      const { data } = await api.post(`/compras/${id}/embarque`, payload);
      return data.data;
    },
    { successMsg: 'Embarque registrado' }
  );

export const useRegisterReceipt = () =>
  useComprasMutation(
    async ({ id, ...payload }) => {
      const { data } = await api.post(`/compras/${id}/nota-ingreso`, payload);
      return data.data;
    },
    { successMsg: 'Nota de ingreso creada (pendiente de confirmar en almacén)' }
  );

export const useCloseCompra = () =>
  useComprasMutation(
    async ({ id }) => {
      const { data } = await api.post(`/compras/${id}/cerrar`);
      return data.data;
    },
    { successMsg: 'Proceso cerrado' }
  );

export const useCancelCompra = () =>
  useComprasMutation(
    async ({ id, razon }) => {
      const { data } = await api.post(`/compras/${id}/anular`, { razon });
      return data.data;
    },
    { successMsg: 'Proceso anulado' }
  );
