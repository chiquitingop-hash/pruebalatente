import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/shared/contexts/AuthContext';

/**
 * Wraps routes that require authentication.
 * Redirects unauthenticated users to /login, preserving intended destination.
 */
const ProtectedRoute = ({ children, module }) => {
  const { isAuthenticated, canAccess } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (module && !canAccess(module)) {
    return <Navigate to="/403" replace />;
  }

  return children;
};

export default ProtectedRoute;

