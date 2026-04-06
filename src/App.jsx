import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import './styles/preview.css'

function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <NavLink to="/"    end className={({isActive}) => isActive ? 'active' : ''}>📊 Dashboard</NavLink>
        <NavLink to="/crm"     className={({isActive}) => isActive ? 'active' : ''}>🎯 CRM</NavLink>
      </nav>
      <Routes>
        <Route path="/"    element={<Dashboard />} />
        <Route path="/crm" element={<CRM />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
