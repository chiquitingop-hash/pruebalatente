/**
 * @module shared/hooks/useApi
 * @description Reusable hooks wrapping React Query for CRUD operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/config/api';

/**
 * Generic list hook with pagination and filters.
 *
 * @param {string}   queryKey   - Unique React Query key
 * @param {string}   endpoint   - API endpoint path
 * @param {Object}   params     - Query params (page, limit, filters)
 * @param {Object}   [options]  - React Query options
 */
export const useList = (queryKey, endpoint, params = {}, options = {}) => {
  return useQuery({
    queryKey: [queryKey, params],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params });
      return data;
    },
    ...options,
  });
};

/**
 * Generic single-item fetch hook.
 */
export const useItem = (queryKey, endpoint, id, options = {}) => {
  return useQuery({
    queryKey: [queryKey, id],
    queryFn: async () => {
      const { data } = await api.get(`${endpoint}/${id}`);
      return data.data;
    },
    enabled: Boolean(id),
    ...options,
  });
};

/**
 * Generic mutation hook for create/update/delete.
 *
 * @param {Function} mutationFn     - Async function to call
 * @param {string[]} invalidateKeys - Query keys to invalidate on success
 * @param {string}   [successMsg]   - Toast message on success
 */
export const useMutate = (mutationFn, invalidateKeys = [], successMsg = null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      if (successMsg) toast.success(successMsg);
    },
    onError: (err) => {
      const details = err.response?.data?.error?.details;
      if (details?.length) {
        details.forEach((d) => toast.error(`${d.field}: ${d.message}`));
      }
      // Global error toast handled by axios interceptor
    },
  });
};

