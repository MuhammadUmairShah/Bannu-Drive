import HistoryList from '../../components/HistoryList';

export default function CustomerDeliveryHistory() {
  return <HistoryList kind="delivery" audience="customer" title="Delivery History" subtitle="Your past parcel dispatches" />;
}
