// frontend/src/components/SummaryCards.tsx
import React from 'react'

export interface Summary {
  totalGranted: number
  nextVesting: string   // ISO date or human string
  percentVested: number // 0–100
}

export default function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded shadow p-4">
        <h3 className="text-gray-600">Total Granted</h3>
        <p className="text-2xl font-semibold">{summary.totalGranted}</p>
      </div>
      <div className="bg-white rounded shadow p-4">
        <h3 className="text-gray-600">Next Vesting</h3>
        <p className="text-2xl font-semibold">{new Date(summary.nextVesting).toLocaleDateString()}</p>
      </div>
      <div className="bg-white rounded shadow p-4">
        <h3 className="text-gray-600">% Vested So Far</h3>
        <p className="text-2xl font-semibold">{summary.percentVested.toFixed(1)}%</p>
      </div>
    </div>
  )
}
