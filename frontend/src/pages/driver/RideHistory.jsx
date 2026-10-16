import HistoryList from '../../components/HistoryList';

export default function DriverRideHistory() {
  return <HistoryList kind="ride" audience="driver" title="Ride History" subtitle="Passenger rides you completed or that were cancelled" />;
}
