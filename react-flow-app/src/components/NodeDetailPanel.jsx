function NodeDetailPanel({ node, onClose }) {
  if (!node) return null;

  const { label, icon, description, tasks } = node.data;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-icon">{icon}</div>
        <div className="detail-title">{label}</div>
        <button className="close-btn" onClick={onClose} aria-label="Close panel">
          &times;
        </button>
      </div>

      <div className="detail-content">
        <p>{description}</p>

        {tasks && tasks.length > 0 && (
          <div className="detail-section">
            <h4>Tasks</h4>
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
          </div>
        )}
      </div>
    </div>
  );
}

export default NodeDetailPanel;
