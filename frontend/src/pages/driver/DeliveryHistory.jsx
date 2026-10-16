import HistoryList from '../../components/HistoryList';

export default function DriverDeliveryHistory() {
  return <HistoryList kind="delivery" audience="driver" title="Delivery History" subtitle="Parcel deliveries you completed or that were cancelled" />;
}
