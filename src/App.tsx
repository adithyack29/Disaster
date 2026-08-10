import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/incident/:clusterId" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
