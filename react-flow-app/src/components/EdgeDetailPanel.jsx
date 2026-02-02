function EdgeDetailPanel({ edge, onClose }) {
  if (!edge) return null;

  const { icons, description, frequency, volume, tasks, bidirectional } = edge;

  return (
    <div className="detail-panel edge-panel">
      <div className="detail-header">
        <div className="detail-icon">{icons.join(' ')}</div>
        <div className="detail-title">Material Flow</div>
        <button className="close-btn" onClick={onClose} aria-label="Close panel">
          &times;
        </button>
      </div>

      <div className="detail-content">
        <p>{description}</p>

        <div className="detail-section">
          <h4>Flow Details</h4>
          <p>
            <strong>Frequency:</strong> {frequency.value} {frequency.unit}
          </p>
          <p>
            <strong>Volume:</strong> {volume.amount} {volume.unit}
          </p>
          {bidirectional && (
            <p>
              <strong>Type:</strong> Bidirectional flow
            </p>
          )}
        </div>

        {tasks && tasks.length > 0 && (
          <div className="detail-section">
            <h4>Work Required</h4>
            <ul className="task-list">
              {tasks.map((task, i) => (
                <li key={i}>
                  {task.name}:{' '}
                  {task.minPerWeek
                    ? `${task.minPerWeek} min/week`
                    : `${task.minPerMonth} min/month`}
                </li>
              ))}
            </ul>
            <p className="total-time">
              Total: {frequency.hoursPerPeriod} hours/{frequency.unit}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default EdgeDetailPanel;
