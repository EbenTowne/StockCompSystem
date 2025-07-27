// frontend/src/components/VestingChart.tsx
import React from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

export interface VestingPoint {
  date: string    // ISO string
  vested: number  // cumulative vested amount at that date
}

export default function VestingChart({ data }: { data: VestingPoint[] }) {
  // convert ISO dates to something readable:
  const display = data.map(d => ({
    ...d,
    date: new Date(d.date).toLocaleDateString(),
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={display} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="vested" stroke="#4f46e5" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
