import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./layout/DashboardLayout";
import LoginPage from "./pages/login/LoginPage";

// 個人
const DashboardPage = lazy(() => import("./pages/personal/dashboard/DashboardPage"));
const QuickTemplateFormPage = lazy(() => import("./pages/personal/dashboard/QuickTemplateFormPage"));
const ResourcesPage = lazy(() => import("./pages/personal/resources/ResourcesPage"));
const ResourceDetailPage = lazy(() => import("./pages/personal/resources/detail/ResourceDetailPage"));
const RequestsPage = lazy(() => import("./pages/personal/requests/RequestsPage"));
const AccountSettingsPage = lazy(() => import("./pages/personal/account/AccountSettingsPage"));

// 資源
const ResourceMgmtPage = lazy(() => import("./pages/resource/resource-mgmt/ResourceMgmtPage"));
const RequestReviewPage = lazy(() => import("./pages/resource/request-review/RequestReviewPage"));
const GpuMgmtPage = lazy(() => import("./pages/resource/gpu-mgmt/GpuMgmtPage"));
const BatchReviewPage = lazy(() => import("./pages/resource/batch-review/BatchReviewPage"));
const TemplatesPage = lazy(() => import("./pages/resource/templates/TemplatesPage"));

// AI
const AiApiPage = lazy(() => import("./pages/ai/ai-api/AiApiPage"));
const AiApiReviewPage = lazy(() => import("./pages/ai/ai-api-review/AiApiReviewPage"));
const AiApiKeysPage = lazy(() => import("./pages/ai/ai-api-keys/AiApiKeysPage"));
const AiMonitoringPage = lazy(() => import("./pages/ai/ai-monitoring/AiMonitoringPage"));

// 教學
const TeachingPage = lazy(() => import("./pages/teaching/TeachingPage"));
const ClassroomPage = lazy(() => import("./pages/classroom/ClassroomPage"));
const CoursePathsPage = lazy(() => import("./pages/courses/paths/CoursePathsPage"));
const CourseRoomPage = lazy(() => import("./pages/courses/room/CourseRoomPage"));
const CourseCmsPage = lazy(() => import("./pages/teaching/course-cms/CourseCmsPage"));
const CourseTemplateManagementPage = lazy(() => import("./pages/course-operations/CourseTemplateManagementPage"));
const CourseTemplateEditorPage = lazy(() => import("./pages/course-operations/CourseTemplateEditorPage"));
const ClassManagementPage = lazy(() => import("./pages/course-operations/ClassManagementPage"));
const ClassCreatePage = lazy(() => import("./pages/course-operations/ClassCreatePage"));
const ClassWorkspacePage = lazy(() => import("./pages/course-operations/ClassWorkspacePage"));

// 系統管理
const GroupsPage = lazy(() => import("./pages/system/groups/GroupsPage"));
const AdminPage = lazy(() => import("./pages/system/admin/AdminPage"));
const SettingsPage = lazy(() => import("./pages/system/settings/SettingsPage"));
const MonitoringPage = lazy(() => import("./pages/system/monitoring/MonitoringPage"));
const QuotasPage = lazy(() => import("./pages/system/quotas/QuotasPage"));
const AuditPage = lazy(() => import("./pages/system/audit/AuditPage"));
const JobsPage = lazy(() => import("./pages/system/jobs/JobsPage"));
const DeployLogsPage = lazy(() => import("./pages/system/deploy-logs/DeployLogsPage"));

// 網路
const FirewallPage = lazy(() => import("./pages/network/firewall/FirewallPage"));
const DomainPage = lazy(() => import("./pages/network/domain/DomainPage"));
const GatewayPage = lazy(() => import("./pages/network/gateway/GatewayPage"));
const ReverseProxyPage = lazy(() => import("./pages/network/reverse-proxy/ReverseProxyPage"));
const IpManagementPage = lazy(() => import("./pages/network/ip-management/IpManagementPage"));

function App() {
  const { user, loading } = useAuth();
  const isAdmin = Boolean(user?.is_superuser || user?.role === "admin");

  if (loading) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />

      {user ? (
        <Route element={<DashboardLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* 個人 */}
          <Route path="/dashboard"            element={<DashboardPage />} />
          <Route path="/quick-template/:id"   element={<QuickTemplateFormPage />} />
          <Route path="/my-resources"         element={<ResourcesPage />} />
          <Route path="/my-resources/:vmid"   element={<ResourceDetailPage backTo="/my-resources" />} />
          <Route path="/my-requests"          element={<RequestsPage />} />
          <Route path="/account"              element={<AccountSettingsPage />} />

          {/* 資源 */}
          <Route path="/resource-mgmt"  element={<ResourceMgmtPage />} />
          <Route path="/resource-mgmt/:vmid" element={<ResourceDetailPage backTo="/resource-mgmt" />} />
          <Route path="/request-review" element={<RequestReviewPage />} />
          <Route path="/gpu-mgmt"       element={<GpuMgmtPage />} />
          <Route path="/batch-review"   element={<BatchReviewPage />} />
          <Route path="/templates"      element={<TemplatesPage />} />

          {/* AI */}
          <Route path="/ai-api"         element={<AiApiPage />} />
          {isAdmin && (
            <>
              <Route path="/ai-api-review" element={<AiApiReviewPage />} />
              <Route path="/ai-api-keys" element={<AiApiKeysPage />} />
              <Route path="/ai-monitoring" element={<AiMonitoringPage />} />
            </>
          )}
          <Route
            path="/ai-management"
            element={<Navigate to={isAdmin ? "/ai-monitoring" : "/ai-api"} replace />}
          />

          {/* 教學 */}
          <Route path="/teaching"  element={<TeachingPage />} />
          <Route path="/classroom" element={<ClassroomPage />} />
          <Route path="/courses"               element={<CoursePathsPage />} />
          <Route path="/courses/rooms/:roomId" element={<CourseRoomPage />} />
          <Route path="/course-cms"            element={<CourseCmsPage />} />

          {/* 課務管理 */}
          <Route path="/course-template-management" element={<CourseTemplateManagementPage />} />
          <Route path="/course-template-management/new" element={<CourseTemplateEditorPage />} />
          <Route path="/course-template-management/:templateId" element={<CourseTemplateEditorPage />} />
          <Route path="/class-management" element={<ClassManagementPage />} />
          <Route path="/class-management/new" element={<ClassCreatePage />} />
          <Route path="/class-management/:classId" element={<ClassWorkspacePage />} />
          <Route path="/class-management/:classId/:section" element={<ClassWorkspacePage />} />

          {/* 系統管理 */}
          <Route path="/groups"    element={<GroupsPage />} />
          <Route path="/admin"     element={<AdminPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
          <Route path="/quotas"    element={<QuotasPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/audit"     element={<AuditPage />} />
          <Route path="/jobs"      element={<JobsPage />} />
          <Route path="/deploy-logs" element={<DeployLogsPage />} />

          {/* 網路 */}
          <Route path="/firewall"       element={<FirewallPage />} />
          <Route path="/domain"         element={<DomainPage />} />
          <Route path="/gateway"        element={<GatewayPage />} />
          <Route path="/reverse-proxy"  element={<ReverseProxyPage />} />
          <Route path="/ip-management"  element={<IpManagementPage />} />

          {/* fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}

export default App;
