import AdminDashboard from '../components/AdminDashboard'
import CounsellorDashboard from '../components/CounsellorDashboard'

type RolePortalProps = {
  role: 'admin' | 'counsellor'
}

function RolePortal({ role }: RolePortalProps) {
  if (role === 'admin') {
    return <AdminDashboard />
  }

  return <CounsellorDashboard />
}

export default RolePortal