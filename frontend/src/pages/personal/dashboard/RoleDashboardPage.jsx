import { useAuth } from "../../../contexts/AuthContext";
import DashboardPage from "./DashboardPage";
import AdminDashboardPage from "./AdminDashboardPage";
import TeacherDashboardPage from "./TeacherDashboardPage";

export default function RoleDashboardPage() {
  const { user } = useAuth();
  if (user?.is_superuser || user?.role === "admin") return <AdminDashboardPage />;
  return user?.role === "teacher" ? <TeacherDashboardPage /> : <DashboardPage />;
}
